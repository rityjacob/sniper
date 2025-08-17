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

// Pump.fun Program ID
const PUMP_FUN_PROGRAM_ID = new PublicKey('troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61');

class DexManager {
    private connection: Connection;

    constructor() {
        this.connection = walletManager.getConnection();
    }

    /**
     * Encode a u64 value as little-endian bytes
     */
    private encodeU64LE(amount: bigint): Buffer {
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64LE(amount);
        return buf;
    }

    /**
     * Decode base64 instruction data and analyze its structure
     */
    private decodeInstructionData(base64Data: string): Buffer {
        try {
            const raw = Buffer.from(base64Data, 'base64');
            logger.logInfo('dex', 'Decoded instruction data', 
                `Length: ${raw.length}, Hex: ${raw.toString('hex').substring(0, 32)}...`
            );
            return raw;
        } catch (error) {
            logger.logError('dex', 'Failed to decode instruction data', error instanceof Error ? error.message : String(error));
            throw new Error('Invalid base64 instruction data');
        }
    }

    /**
     * Analyze instruction structure and extract amount
     */
    private analyzeInstructionStructure(instructionData: Buffer): { functionId: number; amount: bigint; remainingData: Buffer } {
        if (instructionData.length < 9) {
            throw new Error('Instruction data too short');
        }

        const functionId = instructionData[0];
        const amountBytes = instructionData.slice(1, 9);
        const amount = amountBytes.readBigUInt64LE(0);
        const remainingData = instructionData.slice(9);

        logger.logInfo('dex', 'Instruction analysis', 
            `Function ID: ${functionId}, Amount: ${amount}, Remaining bytes: ${remainingData.length}`
        );

        return { functionId, amount, remainingData };
    }

    /**
     * Create new instruction data with updated amount
     */
    private createUpdatedInstructionData(originalData: Buffer, newAmount: bigint): Buffer {
        const { functionId, remainingData } = this.analyzeInstructionStructure(originalData);
        
        const newAmountBytes = this.encodeU64LE(newAmount);
        const updatedData = Buffer.concat([
            Buffer.from([functionId]),
            newAmountBytes,
            remainingData
        ]);

        logger.logInfo('dex', 'Created updated instruction', 
            `Original length: ${originalData.length}, New length: ${updatedData.length}, New amount: ${newAmount}`
        );

        return updatedData;
    }

    /**
     * Convert accounts array to AccountMeta format
     */
    private convertToAccountMeta(accounts: string[], isSigner: boolean = false): AccountMeta[] {
        return accounts.map((account, index) => ({
            pubkey: new PublicKey(account),
            isSigner: index === 0 ? isSigner : false, // First account is usually the signer
            isWritable: true
        }));
    }

    /**
     * Execute swap using Pump.fun AMM
     */
    async executePumpFunSwap(webhookData: PumpFunWebhook, amount: number): Promise<string> {
        try {
            logger.logInfo('dex', 'Executing Pump.fun swap', 
                `Input: ${webhookData.inputMint}, Output: ${webhookData.outputMint}, Amount: ${amount} SOL`
            );

            // Validate webhook data
            if (webhookData.programId !== DEX_CONFIG.pumpFunProgramId) {
                throw new Error('Invalid Pump.fun program ID');
            }

            // Check wallet balance
            const balance = await walletManager.getBalance();
            const requiredBalance = amount + TRANSACTION_CONFIG.minSolBalance;
            
            if (balance < requiredBalance) {
                const error = `Insufficient balance. Have: ${balance} SOL, Need: ${requiredBalance} SOL`;
                logger.logError('dex', 'Insufficient balance for swap', error);
                throw new Error(error);
            }

            // Decode original instruction
            const originalInstructionData = this.decodeInstructionData(webhookData.data);
            
            // Convert amount to lamports (SOL to lamports)
            const amountLamports = BigInt(Math.floor(amount * 1e9));
            
            // Create updated instruction data with new amount
            const updatedInstructionData = this.createUpdatedInstructionData(originalInstructionData, amountLamports);

            // Create transaction instruction
            const instruction = new TransactionInstruction({
                programId: PUMP_FUN_PROGRAM_ID,
                keys: this.convertToAccountMeta(webhookData.accounts, true),
                data: updatedInstructionData
            });

            // Create and send transaction
            const transaction = new Transaction();
            transaction.add(instruction);
            
            // Add priority fee
            transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
            transaction.feePayer = walletManager.getPublicKey();

            logger.logInfo('dex', 'Pump.fun transaction prepared', 'Executing transaction');

            // Execute transaction with retry logic
            let retries = 0;
            while (retries < TRANSACTION_CONFIG.maxRetries) {
                try {
                    const signature = await walletManager.signAndSendTransaction(transaction);
                    logger.logTransaction(signature, webhookData.outputMint, amount.toString(), 'success');
                    logger.logInfo('dex', 'Pump.fun swap successful', `Signature: ${signature}`);
                    return signature;
                } catch (error: any) {
                    if (error.message.includes('0x1771') && retries < TRANSACTION_CONFIG.maxRetries - 1) {
                        retries++;
                        await new Promise(resolve => setTimeout(resolve, 50));
                        continue;
                    }
                    throw error;
                }
            }
            
            throw new Error('Max retries exceeded for Pump.fun swap execution');
        } catch (error: any) {
            logger.logError('dex', 'Pump.fun swap failed', error.message);
            logger.logTransaction('pending', webhookData.outputMint, amount.toString(), 'failed', error.message);
            throw error;
        }
    }

    /**
     * Process webhook data and execute swap
     */
    async processWebhookAndSwap(webhookData: PumpFunWebhook, amount?: number): Promise<string> {
        try {
            // If amount not provided, use the amount from webhook
            const swapAmount = amount || parseFloat(webhookData.amount) / 1e9; // Convert from lamports to SOL
            
            logger.logInfo('dex', 'Processing webhook for swap', 
                `Input: ${webhookData.inputMint}, Output: ${webhookData.outputMint}, Amount: ${swapAmount} SOL`
            );

            return await this.executePumpFunSwap(webhookData, swapAmount);
        } catch (error: any) {
            logger.logError('dex', 'Failed to process webhook and swap', error.message);
            throw error;
        }
    }

    /**
     * Get token price (simplified for Pump.fun - would need real implementation)
     */
    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            // For Pump.fun, we would need to implement price calculation based on bonding curve
            // This is a placeholder implementation
            logger.logInfo('dex', 'Getting token price', `Token: ${tokenAddress}`);
            
            // Placeholder: return a simulated price
            return 0.001; // 0.001 SOL per token
        } catch (error: any) {
            logger.logError('dex', 'Failed to get token price', error.message);
            throw error;
        }
    }

    /**
     * Check liquidity (simplified for Pump.fun)
     */
    async checkLiquidity(tokenAddress: string): Promise<boolean> {
        try {
            // For Pump.fun, liquidity is determined by the bonding curve
            // This is a placeholder implementation
            logger.logInfo('dex', 'Checking liquidity', `Token: ${tokenAddress}`);
            return true; // Assume sufficient liquidity
        } catch (error: any) {
            logger.logError('dex', 'Error checking liquidity', error.message);
            return true;
        }
    }

    /**
     * Execute swap (main entry point - now uses Pump.fun)
     */
    async executeSwap(tokenAddress: string, amount: number, originalPrice?: number): Promise<string> {
        try {
            logger.logInfo('dex', 'Executing swap with Pump.fun', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL`
            );

            // Check wallet balance
            const balance = await walletManager.getBalance();
            const requiredBalance = amount + TRANSACTION_CONFIG.minSolBalance;
            
            if (balance < requiredBalance) {
                const error = `Insufficient balance. Have: ${balance} SOL, Need: ${requiredBalance} SOL`;
                logger.logError('dex', 'Insufficient balance for swap', error);
                throw new Error(error);
            }

            // For Pump.fun, we need webhook data to execute swaps
            // This is a placeholder - in real implementation, you would receive webhook data
            throw new Error('Pump.fun swaps require webhook data. Use processWebhookAndSwap() instead.');
        } catch (error: any) {
            logger.logError('dex', 'Swap execution failed', error.message);
            throw error;
        }
    }

    /**
     * Sell token using Pump.fun (would need webhook data)
     */
    async sellToken(tokenAddress: string, tokenAmount: number): Promise<string> {
        try {
            logger.logInfo('dex', 'Selling token with Pump.fun', 
                `Token: ${tokenAddress}, Amount: ${tokenAmount} tokens`
            );

            // Check token balance
            const balance = await this.getTokenBalance(tokenAddress);
            if (balance < tokenAmount) {
                throw new Error(`Insufficient token balance. Have: ${balance}, Trying to sell: ${tokenAmount}`);
            }

            // For Pump.fun, selling also requires webhook data
            throw new Error('Pump.fun sells require webhook data. Use processWebhookAndSwap() instead.');
        } catch (error: any) {
            logger.logError('dex', 'Token sell failed', error.message);
            throw error;
        }
    }

    /**
     * Get token balance
     */
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

    /**
     * Calculate expected return (simplified for Pump.fun)
     */
    async calculateExpectedReturn(tokenAddress: string, tokenAmount: number): Promise<{
        expectedSol: number;
        priceImpact: number;
        minimumReceived: number;
    }> {
        try {
            // For Pump.fun, this would need to be calculated based on the bonding curve
            // This is a placeholder implementation
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

    /**
     * Calculate price impact (simplified for Pump.fun)
     */
    async calculatePriceImpact(tokenAddress: string, amount: number): Promise<number> {
        try {
            // For Pump.fun, price impact is determined by the bonding curve
            // This is a simplified model
            const simulatedLiquidity = 1000; // Simulated liquidity in SOL
            const priceImpact = (amount / simulatedLiquidity) * 100;
            
            logger.logInfo('dex', 'Price impact calculated', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL, Impact: ${priceImpact.toFixed(2)}%`
            );
            
            return priceImpact;
        } catch (error: any) {
            logger.logError('dex', 'Error calculating price impact', error.message);
            throw error;
        }
    }

    /**
     * Sell percentage of holdings
     */
    async sellPercentageOfHoldings(tokenAddress: string, percentage: number): Promise<string> {
        try {
            if (percentage <= 0 || percentage > 100) {
                throw new Error('Percentage must be between 0 and 100');
            }

            const balance = await this.getTokenBalance(tokenAddress);
            const amountToSell = balance * (percentage / 100);

            if (amountToSell <= 0) {
                throw new Error('No tokens available to sell');
            }

            logger.logInfo('dex', 'Selling percentage of holdings', 
                `Token: ${tokenAddress}, Percentage: ${percentage}%, Amount: ${amountToSell}`
            );

            return await this.sellToken(tokenAddress, amountToSell);
        } catch (error: any) {
            logger.logError('dex', 'Error selling percentage of holdings', error.message);
            throw error;
        }
    }
}

export const dexManager = new DexManager();