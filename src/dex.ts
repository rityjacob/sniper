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
import { 
    PumpFunWebhook, 
    PumpFunSwapParams, 
    SwapResult, 
    TokenBalance,
    SwapCalculation,
    CopyTradeParams
} from './types';
import { 
    PumpAmmSdk,
    PumpAmmInternalSdk,
    buyQuoteInputInternal,
    buyBaseInputInternal,
    sellBaseInputInternal,
    sellQuoteInputInternal,
    PUMP_AMM_PROGRAM_ID_PUBKEY,
    SwapSolanaState
} from '@pump-fun/pump-swap-sdk';

// Pump.fun Program ID
const PUMP_FUN_PROGRAM_ID = new PublicKey('troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

class DexManager {
    private connection: Connection;
    private pumpAmmSdk: PumpAmmSdk;
    private pumpAmmInternalSdk: PumpAmmInternalSdk;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000; // 1 second
    private readonly defaultSlippage = 0.01; // 1% slippage

    constructor() {
        this.connection = walletManager.getConnection();
        this.pumpAmmSdk = new PumpAmmSdk(this.connection);
        this.pumpAmmInternalSdk = new PumpAmmInternalSdk(this.connection);
    }

    /**
     * Extract pool key from webhook data
     * The pool key is typically the token mint address for Pump.fun
     */
    private extractPoolKey(webhookData: PumpFunWebhook): string {
        try {
            // For Pump.fun, the pool key is usually the token mint
            const tokenMint = webhookData.outputMint || webhookData.inputMint;
            
            if (!tokenMint || tokenMint === WSOL_MINT.toString()) {
                throw new Error('Invalid token mint in webhook data');
            }

            logger.logInfo('dex', 'Pool key extracted', `Token mint: ${tokenMint}`);
            return tokenMint;
        } catch (error) {
            logger.logError('dex', 'Error extracting pool key', error instanceof Error ? error.message : String(error));
            throw error;
        }
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
     * Get swap state for a pool
     */
    private async getSwapState(poolKey: string, user: PublicKey): Promise<SwapSolanaState> {
        try {
            logger.logInfo('dex', 'Fetching swap state', `Pool: ${poolKey}`);
            
            const swapSolanaState = await this.pumpAmmSdk.swapSolanaState(
                new PublicKey(poolKey), 
                user
            );

            logger.logInfo('dex', 'Swap state fetched', 
                `Pool: ${poolKey}, Base: ${swapSolanaState.poolBaseAmount.toString()}, Quote: ${swapSolanaState.poolQuoteAmount.toString()}`
            );

            return swapSolanaState;
        } catch (error) {
            logger.logError('dex', 'Error fetching swap state', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Calculate buy amount using Pump Swap SDK
     */
    private calculateBuyAmount(
        swapState: SwapSolanaState, 
        quoteAmount: bigint, 
        slippage: number
    ): SwapCalculation {
        try {
            const { globalConfig, pool, poolBaseAmount, poolQuoteAmount } = swapState;

            const result = buyQuoteInputInternal(
                quoteAmount,
                slippage,
                poolBaseAmount,
                poolQuoteAmount,
                globalConfig,
                pool.creator
            );

            logger.logInfo('dex', 'Buy amount calculated', 
                `Quote: ${quoteAmount.toString()}, Base: ${result.base.toString()}, Max Quote: ${result.maxQuote.toString()}`
            );

            return { uiQuote: Number(result.maxQuote) / 1e9, base: result.base, quote: quoteAmount };
        } catch (error) {
            logger.logError('dex', 'Error calculating buy amount', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Calculate sell amount using Pump Swap SDK
     */
    private calculateSellAmount(
        swapState: SwapSolanaState, 
        baseAmount: bigint, 
        slippage: number
    ): SwapCalculation {
        try {
            const { globalConfig, pool, poolBaseAmount, poolQuoteAmount } = swapState;

            const result = sellBaseInputInternal(
                baseAmount,
                slippage,
                poolBaseAmount,
                poolQuoteAmount,
                globalConfig,
                pool.creator
            );

            logger.logInfo('dex', 'Sell amount calculated', 
                `Base: ${baseAmount.toString()}, Min Quote: ${result.minQuote.toString()}, UI Quote: ${result.uiQuote.toString()}`
            );

            return { uiQuote: Number(result.uiQuote) / 1e9, base: baseAmount, quote: result.minQuote };
        } catch (error) {
            logger.logError('dex', 'Error calculating sell amount', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Execute buy transaction using Pump Swap SDK
     */
    private async executeBuy(
        swapState: SwapSolanaState, 
        quoteAmount: bigint, 
        slippage: number
    ): Promise<string> {
        try {
            logger.logInfo('dex', 'Executing buy transaction', 
                `Quote amount: ${quoteAmount.toString()}, Slippage: ${slippage}`
            );

            // Use buyQuoteInput for buying tokens with SOL
            const instructions = await this.pumpAmmInternalSdk.buyQuoteInput(
                swapState,
                quoteAmount,
                slippage
            );

            // Create and send transaction
            const transaction = new Transaction();
            transaction.add(...instructions);
            
            const signature = await walletManager.signAndSendTransaction(transaction);

            logger.logInfo('dex', 'Buy transaction successful', `Signature: ${signature}`);
            return signature;
        } catch (error) {
            logger.logError('dex', 'Buy transaction failed', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Execute sell transaction using Pump Swap SDK
     */
    private async executeSell(
        swapState: SwapSolanaState, 
        baseAmount: bigint, 
        slippage: number
    ): Promise<string> {
        try {
            logger.logInfo('dex', 'Executing sell transaction', 
                `Base amount: ${baseAmount.toString()}, Slippage: ${slippage}`
            );

            // Use sellBaseInput for selling tokens for SOL
            const instructions = await this.pumpAmmInternalSdk.sellBaseInput(
                swapState,
                baseAmount,
                slippage
            );

            // Create and send transaction
            const transaction = new Transaction();
            transaction.add(...instructions);
            
            const signature = await walletManager.signAndSendTransaction(transaction);

            logger.logInfo('dex', 'Sell transaction successful', `Signature: ${signature}`);
            return signature;
        } catch (error) {
            logger.logError('dex', 'Sell transaction failed', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Check SOL balance for trade
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
     * Main method to process webhook and execute copy trade
     */
    async processLeaderBuyWebhook(webhookData: PumpFunWebhook, fixedBuyAmount: number = 0.1): Promise<string> {
        try {
            logger.logInfo('dex', 'Processing leader buy webhook', 'Starting copy trade execution');
            
            // Extract pool key (token mint)
            const poolKey = this.extractPoolKey(webhookData);
            
            // Get target wallet from environment
            const targetWallet = process.env.TARGET_WALLET_ADDRESS;
            if (!targetWallet) {
                throw new Error('TARGET_WALLET_ADDRESS not configured');
            }

            // Determine if target is buying or selling
            const isBuying = this.isTargetWalletBuying(webhookData, targetWallet);
            
            if (!isBuying) {
                logger.logInfo('dex', 'Skipping non-buy transaction', 'Target wallet is selling, not buying');
                throw new Error('Target wallet is selling, not buying');
            }

            // Get user wallet
            const userWallet = walletManager.getPublicKey();
            
            // Get swap state
            const swapState = await this.getSwapState(poolKey, userWallet);
            
            // Check SOL balance
            if (!(await this.checkSolBalance(fixedBuyAmount))) {
                throw new Error('Insufficient SOL balance for trade');
            }

            // Convert SOL amount to lamports
            const quoteAmount = BigInt(Math.floor(fixedBuyAmount * 1e9));
            
            // Calculate buy amount
            const buyCalculation = this.calculateBuyAmount(swapState, quoteAmount, this.defaultSlippage);
            
            logger.logInfo('dex', 'Trade calculation complete', 
                `Buying ${buyCalculation.base.toString()} tokens for ${fixedBuyAmount} SOL`
            );

            // Execute buy transaction
            const signature = await this.executeBuy(swapState, quoteAmount, this.defaultSlippage);

            // Post-trade logging
            logger.logTransaction(signature, poolKey, fixedBuyAmount.toString(), 'success');
            logger.logInfo('dex', 'Copy trade completed successfully', 
                `Signature: ${signature}, Token: ${poolKey}, Amount: ${fixedBuyAmount} SOL`
            );

            return signature;
        } catch (error: any) {
            logger.logError('dex', 'Leader buy webhook processing failed', error.message);
            logger.logTransaction('pending', webhookData.outputMint || 'unknown', '0', 'failed', error.message);
            throw error;
        }
    }

    /**
     * Process copy trade with custom parameters
     */
    async processCopyTrade(params: CopyTradeParams): Promise<string> {
        try {
            logger.logInfo('dex', 'Processing copy trade', 
                `Token: ${params.tokenMint}, Amount: ${params.buyAmount} SOL, Is Buy: ${params.isBuy}`
            );

            const userWallet = walletManager.getPublicKey();
            const swapState = await this.getSwapState(params.poolKey, userWallet);
            
            if (params.isBuy) {
                // Check SOL balance for buy
                if (!(await this.checkSolBalance(params.buyAmount))) {
                    throw new Error('Insufficient SOL balance for buy');
                }

                const quoteAmount = BigInt(Math.floor(params.buyAmount * 1e9));
                const buyCalculation = this.calculateBuyAmount(swapState, quoteAmount, params.slippage);
                
                logger.logInfo('dex', 'Buy calculation', 
                    `Buying ${buyCalculation.base.toString()} tokens for ${params.buyAmount} SOL`
                );

                return await this.executeBuy(swapState, quoteAmount, params.slippage);
            } else {
                // For selling, we need to check token balance instead
                const tokenBalance = await this.getTokenBalance(params.tokenMint);
                if (tokenBalance <= 0) {
                    throw new Error('Insufficient token balance for sell');
                }

                // Convert percentage of holdings to base amount
                const baseAmount = BigInt(Math.floor(tokenBalance * 1e9)); // Assuming 9 decimals
                const sellCalculation = this.calculateSellAmount(swapState, baseAmount, params.slippage);
                
                logger.logInfo('dex', 'Sell calculation', 
                    `Selling ${sellCalculation.base.toString()} tokens for ${sellCalculation.uiQuote} SOL`
                );

                return await this.executeSell(swapState, baseAmount, params.slippage);
            }
        } catch (error: any) {
            logger.logError('dex', 'Copy trade processing failed', error.message);
            throw error;
        }
    }

    /**
     * Legacy methods for backward compatibility
     */
    async executeSwap(tokenAddress: string, amount: number, originalPrice?: number): Promise<string> {
        throw new Error('Use processLeaderBuyWebhook() or processCopyTrade() for Pump.fun trades');
    }

    async sellToken(tokenAddress: string, tokenAmount: number): Promise<string> {
        try {
            const params: CopyTradeParams = {
                tokenMint: tokenAddress,
                poolKey: tokenAddress,
                leaderWallet: '',
                buyAmount: 0,
                slippage: this.defaultSlippage,
                isBuy: false
            };
            return await this.processCopyTrade(params);
        } catch (error: any) {
            logger.logError('dex', 'Sell token failed', error.message);
            throw error;
        }
    }

    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const userWallet = walletManager.getPublicKey();
            const swapState = await this.getSwapState(tokenAddress, userWallet);
            
            // Calculate price based on pool reserves
            const price = Number(swapState.poolQuoteAmount) / Number(swapState.poolBaseAmount);
            
            logger.logInfo('dex', 'Token price calculated', `Token: ${tokenAddress}, Price: ${price}`);
            return price;
        } catch (error: any) {
            logger.logError('dex', 'Failed to get token price', error.message);
            return 0;
        }
    }

    async checkLiquidity(tokenAddress: string): Promise<boolean> {
        try {
            const userWallet = walletManager.getPublicKey();
            const swapState = await this.getSwapState(tokenAddress, userWallet);
            
            // Check if pool has sufficient liquidity
            const hasLiquidity = swapState.poolBaseAmount > 0n && swapState.poolQuoteAmount > 0n;
            
            logger.logInfo('dex', 'Liquidity check', 
                `Token: ${tokenAddress}, Has liquidity: ${hasLiquidity}`
            );
            
            return hasLiquidity;
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
            const userWallet = walletManager.getPublicKey();
            const swapState = await this.getSwapState(tokenAddress, userWallet);
            
            // Calculate price impact based on trade size vs pool size
            const tradeAmount = BigInt(Math.floor(amount * 1e9));
            const priceImpact = Number(tradeAmount) / Number(swapState.poolQuoteAmount) * 100;
            
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
            const userWallet = walletManager.getPublicKey();
            const swapState = await this.getSwapState(tokenAddress, userWallet);
            
            const baseAmount = BigInt(Math.floor(tokenAmount * 1e9));
            const sellCalculation = this.calculateSellAmount(swapState, baseAmount, this.defaultSlippage);
            
            const priceImpact = await this.calculatePriceImpact(tokenAddress, tokenAmount);
            const expectedSol = sellCalculation.uiQuote;
            const minimumReceived = expectedSol * (1 - this.defaultSlippage);
            
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
        if (percentage <= 0 || percentage > 100) {
            throw new Error('Percentage must be between 0 and 100');
        }

        try {
            const tokenBalance = await this.getTokenBalance(tokenAddress);
            const sellAmount = (tokenBalance * percentage) / 100;
            
            const params: CopyTradeParams = {
                tokenMint: tokenAddress,
                poolKey: tokenAddress,
                leaderWallet: '',
                buyAmount: 0,
                slippage: this.defaultSlippage,
                isBuy: false
            };
            
            return await this.processCopyTrade(params);
        } catch (error: any) {
            logger.logError('dex', 'Sell percentage failed', error.message);
            throw error;
        }
    }
}

export const dexManager = new DexManager();