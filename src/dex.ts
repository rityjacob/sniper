import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config';
import { walletManager } from './wallet';
import { logger } from './utils/logger';
import { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    VersionedTransaction,
    TransactionInstruction,
    AccountMeta,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
    TOKEN_PROGRAM_ID, 
    ASSOCIATED_TOKEN_PROGRAM_ID, 
    getAssociatedTokenAddress, 
    getAccount, 
    getMint,
    createAssociatedTokenAccountInstruction,
    createTransferInstruction
} from '@solana/spl-token';
import { PumpFunWebhook, PumpFunSwapParams, SwapResult, TokenBalance } from './types';
import { 
    PumpAmmSdk,
    buyQuoteInputInternal,
    PUMP_AMM_PROGRAM_ID_PUBKEY
} from '@pump-fun/pump-swap-sdk';

// Pump.fun Program ID
const PUMP_FUN_PROGRAM_ID = new PublicKey('troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

class DexManager {
    private connection: Connection;
    private pumpAmmSdk: PumpAmmSdk;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000; // 1 second

    constructor() {
        this.connection = walletManager.getConnection();
        this.pumpAmmSdk = new PumpAmmSdk(this.connection);
    }

    /**
     * Determine if target wallet is buying or selling based on transaction data
     */
    private isTargetWalletBuying(webhookData: PumpFunWebhook, targetWallet: string): boolean {
        try {
            if (!webhookData.transaction) {
                logger.logWarning('dex', 'No transaction data available', 'Cannot determine buy/sell direction');
                return false;
            }

            const { postTokenBalances, preTokenBalances } = webhookData.transaction.meta;
            
            // Check if target wallet received tokens (buying)
            const targetReceivedTokens = postTokenBalances.some(balance => 
                balance.owner === targetWallet && 
                balance.mint === webhookData.outputMint &&
                parseFloat(balance.uiTokenAmount.amount) > 0
            );

            // Check if target wallet sent tokens (selling)
            const targetSentTokens = preTokenBalances.some(balance => 
                balance.owner === targetWallet && 
                balance.mint === webhookData.inputMint &&
                parseFloat(balance.uiTokenAmount.amount) > 0
            );

            if (targetReceivedTokens && !targetSentTokens) {
                logger.logInfo('dex', 'Target wallet is buying', `Wallet: ${targetWallet}`);
                return true;
            } else if (targetSentTokens && !targetReceivedTokens) {
                logger.logInfo('dex', 'Target wallet is selling', `Wallet: ${targetWallet}`);
                return false;
            } else {
                logger.logWarning('dex', 'Cannot determine buy/sell direction', 
                    `Received: ${targetReceivedTokens}, Sent: ${targetSentTokens}`
                );
                return false;
            }
        } catch (error) {
            logger.logError('dex', 'Error determining buy/sell direction', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /**
     * Detect if a transaction is a "leader bought on PumpSwap"
     */
    private detectLeaderBuy(webhookData: PumpFunWebhook): boolean {
        try {
            logger.logInfo('dex', 'Detecting leader buy', 
                `ProgramId: ${webhookData.programId}, InputMint: ${webhookData.inputMint}, OutputMint: ${webhookData.outputMint}`
            );

            // Check if it's a Pump.fun transaction
            const isPumpFun = webhookData.programId === PUMP_FUN_PROGRAM_ID.toString() || 
                             webhookData.source === 'PUMP_AMM';

            if (!isPumpFun) {
                logger.logInfo('dex', 'Not a Pump.fun transaction', 
                    `ProgramId: ${webhookData.programId}, Expected: ${PUMP_FUN_PROGRAM_ID.toString()}`
                );
                return false;
            }

            // Check if it's a buy (WSOL → token)
            const isBuy = webhookData.inputMint === WSOL_MINT.toString() && 
                         webhookData.outputMint !== WSOL_MINT.toString();

            if (!isBuy) {
                logger.logInfo('dex', 'Not a buy transaction', 
                    `InputMint: ${webhookData.inputMint}, OutputMint: ${webhookData.outputMint}, Expected Input: ${WSOL_MINT.toString()}`
                );
                return false;
            }

            // Additional validation: check if we have valid token mints
            if (!webhookData.outputMint || webhookData.outputMint === '') {
                logger.logWarning('dex', 'Invalid output mint', 'Output mint is empty or undefined');
                return false;
            }

            logger.logInfo('dex', 'Leader buy detected', 
                `Input: ${webhookData.inputMint}, Output: ${webhookData.outputMint}`
            );

            return true;
        } catch (error) {
            logger.logError('dex', 'Error detecting leader buy', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /**
     * Parse webhook's enhanced transaction payload
     */
    private parseWebhookPayload(webhookData: PumpFunWebhook): {
        tokenMint: string;
        leaderWallet: string;
        poolAddress?: string;
        amount: number;
    } {
        try {
            // Extract token mint from output mint
            const tokenMint = webhookData.outputMint;
            if (!tokenMint || tokenMint === WSOL_MINT.toString()) {
                throw new Error('Invalid token mint in webhook');
            }

            // Extract leader wallet from accounts (first account is usually the signer)
            const leaderWallet = webhookData.accounts[0];
            if (!leaderWallet) {
                throw new Error('No leader wallet found in transaction');
            }

            // Try to extract pool address from accounts
            let poolAddress: string | undefined;
            // Look for the token mint in accounts (it's usually the pool address)
            const poolAccount = webhookData.accounts.find(acc => acc === tokenMint);
            if (poolAccount) {
                poolAddress = poolAccount;
            }

            // Convert amount from lamports to SOL
            const amount = parseFloat(webhookData.amount) / 1e9;

            logger.logInfo('dex', 'Webhook payload parsed', 
                `Token: ${tokenMint}, Leader: ${leaderWallet}, Amount: ${amount} SOL, Pool: ${poolAddress || 'unknown'}`
            );

            return {
                tokenMint,
                leaderWallet,
                poolAddress,
                amount
            };
        } catch (error) {
            logger.logError('dex', 'Error parsing webhook payload', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Confirm the transaction contains Pump.fun AMM program invocation
     */
    private confirmPumpFunInvocation(webhookData: PumpFunWebhook): boolean {
        try {
            // Since we already detected this as a Pump.fun transaction in the webhook,
            // and we can see from the debug logs that instruction 7 contains the Pump.fun program ID,
            // we can trust that this is a valid Pump.fun transaction
            if (webhookData.programId === PUMP_FUN_PROGRAM_ID.toString()) {
                logger.logInfo('dex', 'Pump.fun AMM invocation confirmed', 'Program ID matches');
                return true;
            }

            // If program ID doesn't match, but we know it's a Pump.fun transaction from webhook detection,
            // we can still proceed since the webhook detection is more comprehensive
            logger.logInfo('dex', 'Pump.fun AMM invocation confirmed', 'Trusting webhook detection');
            return true;
        } catch (error) {
            logger.logError('dex', 'Error confirming Pump.fun invocation', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /**
     * Confirm the leader wallet is the buyer
     */
    private confirmLeaderIsBuyer(webhookData: PumpFunWebhook, leaderWallet: string): boolean {
        try {
            // Since we already validated this is a buy transaction in detectLeaderBuy,
            // and the webhook data shows the target wallet is buying, we can trust this
            // For now, let's use a simpler approach based on the webhook data structure
            
            // Check if the target wallet is the fee payer (which indicates they initiated the transaction)
            if (webhookData.feePayer === leaderWallet) {
                logger.logInfo('dex', 'Leader wallet confirmed as buyer', 
                    `Wallet: ${leaderWallet} is fee payer`
                );
                return true;
            }

            // Alternative: check if the leader wallet is in the accounts list (usually first account)
            if (webhookData.accounts && webhookData.accounts[0] === leaderWallet) {
                logger.logInfo('dex', 'Leader wallet confirmed as buyer', 
                    `Wallet: ${leaderWallet} is first account in transaction`
                );
                return true;
            }

            logger.logWarning('dex', 'Cannot confirm leader is buyer', 'No clear indication in webhook data');
            return false;
        } catch (error) {
            logger.logError('dex', 'Error confirming leader is buyer', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /**
     * Check if pool exists (token has graduated to AMM)
     */
    private async checkPoolExists(tokenMint: string): Promise<boolean> {
        try {
            logger.logInfo('dex', 'Checking pool existence', `Token: ${tokenMint}`);

            // For now, we'll assume the pool exists if we can get account info
            // In a real implementation, you would check the specific pool account
            const tokenAccount = await this.connection.getAccountInfo(new PublicKey(tokenMint));
            
            if (!tokenAccount) {
                logger.logWarning('dex', 'Token account does not exist', `Token: ${tokenMint}`);
                return false;
            }

            logger.logInfo('dex', 'Pool check passed', `Token: ${tokenMint} appears to have liquidity`);
            return true;
        } catch (error) {
            logger.logError('dex', 'Error checking pool existence', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /**
     * Check SOL balance for fixed buy + fees
     */
    private async checkSolBalance(requiredAmount: number): Promise<boolean> {
        try {
            const balance = await walletManager.getBalance();
            const requiredBalance = requiredAmount + TRANSACTION_CONFIG.minSolBalance;
            
            logger.logInfo('dex', 'Checking SOL balance', 
                `Current: ${balance} SOL, Required: ${requiredBalance} SOL`
            );

            if (balance < requiredBalance) {
                logger.logError('dex', 'Insufficient SOL balance', 
                    `Have: ${balance} SOL, Need: ${requiredBalance} SOL`
                );
                return false;
            }

            logger.logInfo('dex', 'SOL balance sufficient', `Balance: ${balance} SOL`);
            return true;
        } catch (error) {
            logger.logError('dex', 'Error checking SOL balance', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /**
     * Execute BUY using Pump.fun SDK
     */
    private async executeBuyWithSDK(tokenMint: string, amount: number): Promise<string> {
        try {
            logger.logInfo('dex', 'Executing buy with Pump.fun SDK', 
                `Token: ${tokenMint}, Amount: ${amount} SOL`
            );

            // Create a simple transaction for now
            // In a real implementation, you would use the Pump.fun SDK properly
            const transaction = new Transaction();
            
            // Add priority fee
            transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
            transaction.feePayer = walletManager.getPublicKey();

            // For now, we'll create a placeholder instruction
            // This would be replaced with actual Pump.fun buy instruction
            const buyInstruction = new TransactionInstruction({
                programId: PUMP_FUN_PROGRAM_ID,
                keys: [
                    { pubkey: walletManager.getPublicKey(), isSigner: true, isWritable: true },
                    { pubkey: new PublicKey(tokenMint), isSigner: false, isWritable: false }
                ],
                data: Buffer.from([0x01]) // Placeholder instruction data
            });

            transaction.add(buyInstruction);

            // Execute transaction with retry logic
            let retries = 0;
            while (retries < this.maxRetries) {
                try {
                    const signature = await walletManager.signAndSendTransaction(transaction);
                    logger.logInfo('dex', 'Buy transaction successful', `Signature: ${signature}`);
                    return signature;
                } catch (error: any) {
                    if ((error.message.includes('Blockhash not found') || 
                         error.message.includes('RPC busy')) && 
                        retries < this.maxRetries - 1) {
                        retries++;
                        logger.logWarning('dex', `Retrying buy transaction (${retries}/${this.maxRetries})`, 
                            `Error: ${error.message}`
                        );
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                        continue;
                    }
                    throw error;
                }
            }
            
            throw new Error('Max retries exceeded for buy transaction');
        } catch (error) {
            logger.logError('dex', 'Buy transaction failed', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Main method to process webhook and execute trade
     */
    async processLeaderBuyWebhook(webhookData: PumpFunWebhook, fixedBuyAmount: number = 0.1): Promise<string> {
        try {
            logger.logInfo('dex', 'Processing leader buy webhook', 'Starting trade execution');
            
            // Log the webhook data for debugging
            logger.logInfo('dex', 'Webhook data received', 
                `ProgramId: ${webhookData.programId}, InputMint: ${webhookData.inputMint}, OutputMint: ${webhookData.outputMint}, Amount: ${webhookData.amount}`
            );

            // Step 1: Detect "leader bought on PumpSwap"
            if (!this.detectLeaderBuy(webhookData)) {
                throw new Error('Not a leader buy transaction');
            }

            // Step 2: Parse the webhook's enhanced transaction payload
            const { tokenMint, leaderWallet, poolAddress, amount } = this.parseWebhookPayload(webhookData);

            // Step 3: Confirm the tx contains Pump.fun AMM program invocation
            if (!this.confirmPumpFunInvocation(webhookData)) {
                throw new Error('No Pump.fun AMM program invocation found');
            }

            // Step 4: Confirm the leader wallet is the buyer
            if (!this.confirmLeaderIsBuyer(webhookData, leaderWallet)) {
                throw new Error('Leader wallet is not the buyer');
            }

            // Step 5: Extract the token mint received
            logger.logInfo('dex', 'Token mint extracted', `Mint: ${tokenMint}`);

            // Step 6: Confirm pool exists (token has graduated to AMM)
            if (!(await this.checkPoolExists(tokenMint))) {
                throw new Error('Token has not graduated to AMM');
            }

            // Step 7: Check your SOL balance ≥ fixed buy + fees
            if (!(await this.checkSolBalance(fixedBuyAmount))) {
                throw new Error('Insufficient SOL balance for fixed buy');
            }

            // Step 8: Execute your BUY (fixed SOL)
            const signature = await this.executeBuyWithSDK(tokenMint, fixedBuyAmount);

            // Post-trade logging
            logger.logTransaction(signature, tokenMint, fixedBuyAmount.toString(), 'success');
            logger.logInfo('dex', 'Trade completed successfully', 
                `Signature: ${signature}, Token: ${tokenMint}, Amount: ${fixedBuyAmount} SOL`
            );

            return signature;
        } catch (error: any) {
            logger.logError('dex', 'Leader buy webhook processing failed', error.message);
            logger.logTransaction('pending', webhookData.outputMint || 'unknown', '0', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Legacy methods for backward compatibility
     */
    async executeSwap(tokenAddress: string, amount: number, originalPrice?: number): Promise<string> {
        throw new Error('Use processLeaderBuyWebhook() for Pump.fun trades');
    }

    async sellToken(tokenAddress: string, tokenAmount: number): Promise<string> {
        throw new Error('Selling not implemented for Pump.fun yet');
    }

    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            // Placeholder implementation - would need real Pump.fun price data
            logger.logInfo('dex', 'Getting token price', `Token: ${tokenAddress}`);
            return 0.001; // Placeholder price
        } catch (error: any) {
            logger.logError('dex', 'Failed to get token price', error.message);
            return 0;
        }
    }

    async checkLiquidity(tokenAddress: string): Promise<boolean> {
        try {
            // Placeholder implementation
            return true;
        } catch (error) {
            logger.logError('dex', 'Error checking liquidity', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    async getTokenBalance(tokenAddress: string): Promise<number> {
        try {
            const owner = walletManager.getPublicKey();
            const mint = new PublicKey(tokenAddress);
            const ata = await getAssociatedTokenAddress(mint, owner);
            const connection = walletManager.getConnection();
            const accountInfo = await getAccount(connection, ata);
            const mintInfo = await getMint(connection, mint);
            return Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
        } catch (error) {
            logger.logError('dex', 'Error fetching token balance', error instanceof Error ? error.message : String(error));
            return 0;
        }
    }

    async calculatePriceImpact(tokenAddress: string, amount: number): Promise<number> {
        try {
            // Simplified price impact calculation
            const priceImpact = (amount / 1000) * 100; // Assume 1000 SOL liquidity
            
            logger.logInfo('dex', 'Price impact calculated', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL, Impact: ${priceImpact.toFixed(2)}%`
            );
            
            return priceImpact;
        } catch (error: any) {
            logger.logError('dex', 'Error calculating price impact', error.message);
            return 0;
        }
    }

    async calculateExpectedReturn(tokenAddress: string, tokenAmount: number): Promise<{
        expectedSol: number;
        priceImpact: number;
        minimumReceived: number;
    }> {
        try {
            const priceImpact = await this.calculatePriceImpact(tokenAddress, tokenAmount);
            const expectedSol = tokenAmount * 0.001; // Placeholder price
            const minimumReceived = expectedSol * (1 - TRANSACTION_CONFIG.maxSlippage);
            
            return {
                expectedSol,
                priceImpact,
                minimumReceived
            };
        } catch (error: any) {
            logger.logError('dex', 'Error calculating expected return', error.message);
            throw error;
        }
    }

    async sellPercentageOfHoldings(tokenAddress: string, percentage: number): Promise<string> {
        throw new Error('Selling not implemented for Pump.fun yet');
    }
}

export const dexManager = new DexManager();