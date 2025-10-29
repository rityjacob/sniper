import { 
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    VersionedTransaction,
    ComputeBudgetProgram,
    TransactionInstruction
} from '@solana/web3.js';
import fetch from 'node-fetch';
import { 
    WALLET_PRIVATE_KEY,
    NETWORK,
    RPC_URL,
    COMPUTE_UNIT_LIMIT,
    COMPUTE_UNIT_PRICE
} from './config';
import bs58 from 'bs58';
import * as fs from 'fs';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { logger } from './utils/logger';

export class WalletManager {
    private connection: Connection;
    private wallet: Keypair;

    constructor() {
        this.connection = new Connection(RPC_URL);
        this.wallet = this.initializeWallet();
    }

    private initializeWallet(): Keypair {
        try {
            if (!WALLET_PRIVATE_KEY) {
                // If no private key is set, try to load from target-wallet.json
                const targetWalletPath = 'target-wallet.json';
                if (fs.existsSync(targetWalletPath)) {
                    const targetWalletData = JSON.parse(fs.readFileSync(targetWalletPath, 'utf-8'));
                    return Keypair.fromSecretKey(new Uint8Array(targetWalletData));
                }
                throw new Error('No wallet private key found in .env or target-wallet.json');
            }
            const privateKey = bs58.decode(WALLET_PRIVATE_KEY);
            return Keypair.fromSecretKey(privateKey);
        } catch (error) {
            console.error("❌ Failed to initialize wallet:", error);
            throw error;
        }
    }

    async getBalance(): Promise<number> {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            return balance / 1e9; // Convert lamports to SOL
        } catch (error) {
            console.error("❌ Failed to get balance:", error);
            throw error;
        }
    }

    async checkMinimumBalance(): Promise<boolean> {
        const balance = await this.getBalance();
        return balance >= 0.0001; // Minimum balance check
    }

    /**
     * Enhanced balance check for trading with proper fee estimation
     */
    async checkTradingBalance(requiredAmount: number): Promise<{
        hasEnoughBalance: boolean;
        currentBalance: number;
        requiredBalance: number;
        deficit?: number;
    }> {
        const currentBalance = await this.getBalance();
        const feeBuffer = 0.01; // 0.01 SOL buffer for transaction fees
        const requiredBalance = requiredAmount + feeBuffer;
        
        return {
            hasEnoughBalance: currentBalance >= requiredBalance,
            currentBalance,
            requiredBalance,
            deficit: currentBalance < requiredBalance ? requiredBalance - currentBalance : undefined
        };
    }

    /**
     * Ultra-fast transaction execution pipeline with Helius optimizations
     */
    async signAndSendTransaction(transaction: Transaction | VersionedTransaction, options?: {
        skipSimulation?: boolean;
        skipPreflight?: boolean;
        commitment?: 'processed' | 'confirmed' | 'finalized';
    }): Promise<string> {
        try {
            // Step 1: Get fresh blockhash
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
            console.log(`📡 Fresh blockhash: ${blockhash}`);

            // Step 2: Get dynamic priority fees from recent data
            const dynamicFees = await this.getDynamicPriorityFee();

            // Add compute unit instructions for legacy transactions
            if (transaction instanceof Transaction) {
                // Step 3: Add ComputeBudgetProgram instructions only if not already present
                const hasComputeBudgetIx = transaction.instructions.some(ix =>
                    ix.programId.equals(ComputeBudgetProgram.programId)
                );

                if (!hasComputeBudgetIx) {
                    const computeUnitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
                        units: COMPUTE_UNIT_LIMIT   
                    });
                    const computeUnitPriceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: dynamicFees.computeUnitPrice
                    });
                    transaction.instructions.unshift(computeUnitPriceInstruction);
                    transaction.instructions.unshift(computeUnitInstruction);
                }

                transaction.recentBlockhash = blockhash;
                transaction.sign(this.wallet);
            } else {
                // Handle versioned transaction
                transaction.sign([this.wallet]);
            }

            console.log(`🚀 Building transaction - CU limit: ${COMPUTE_UNIT_LIMIT}, CU price: ${dynamicFees.computeUnitPrice}`);

            // Step 4: Optional simulation (skip in ultra-low-latency mode)
            if (!options?.skipSimulation) {
                try {
                    // Only simulate versioned transactions for now to avoid TypeScript issues
                    if (transaction instanceof VersionedTransaction) {
                        const simulation = await this.connection.simulateTransaction(transaction, {
                            commitment: 'processed',
                            sigVerify: false
                        });
                        
                        if (simulation.value.err) {
                            throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
                        }
                        console.log(`✅ Simulation passed - CU used: ${simulation.value.unitsConsumed}`);
                    } else {
                        console.log(`⚠️ Skipping simulation for legacy transaction`);
                    }
                } catch (simError) {
                    console.log(`⚠️ Simulation failed, proceeding anyway: ${simError}`);
                }
            }

            // Step 5: Send transaction via Helius RPC with skipPreflight for ultra-low latency
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: options?.skipPreflight ?? true, // Default to true for speed
                    maxRetries: 2,
                    preflightCommitment: options?.commitment || 'processed'
                }
            );

            console.log(`📝 Transaction sent: ${signature}`);

            // Step 6: Fast confirmation using getSignatureStatuses
            const confirmation = await this.confirmTransactionFast(signature, options?.commitment || 'confirmed');
            
            console.log(`✅ Transaction confirmed: ${signature}`);
            return signature;
        } catch (error: any) {
            logger.logError('wallet', 'Transaction failed', error.message);
            throw error;
        }
    }

    /**
     * Fast transaction confirmation using multiple strategies
     */
    private async confirmTransactionFast(signature: string, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<any> {
        const maxAttempts = 10;
        const startTime = Date.now();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Try getSignatureStatuses first (fastest)
                const statuses = await this.connection.getSignatureStatuses([signature], {
                    searchTransactionHistory: false
                });

                const status = statuses.value[0];
                if (status && status.confirmationStatus) {
                    const elapsed = Date.now() - startTime;
                    console.log(`🎯 Fast confirmation (${elapsed}ms): ${status.confirmationStatus}`);
                    
                    if (status.err) {
                        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
                    }
                    return status;
                }

                // Fallback to Enhanced Transaction API if available
                if (attempt > 3) {
                    try {
                        const enhancedStatus = await this.getTransactionStatus(signature);
                        if (enhancedStatus && enhancedStatus.confirmationStatus) {
                            const elapsed = Date.now() - startTime;
                            console.log(`🎯 Enhanced confirmation (${elapsed}ms): ${enhancedStatus.confirmationStatus}`);
                            return enhancedStatus;
                        }
                    } catch (enhancedError) {
                        // Continue with standard confirmation
                    }
                }

                console.log(`⏳ Confirmation attempt ${attempt}/${maxAttempts}...`);
                await new Promise(resolve => setTimeout(resolve, 200)); // 200ms intervals
            } catch (error) {
                console.log(`⚠️ Confirmation error (attempt ${attempt}):`, error);
                if (attempt === maxAttempts) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
    }

    async calculateOptimalTradeAmount(tokenAddress: string): Promise<number> {
        try {
            const balance = await this.getBalance();
            const maxAmount = 0.1; // Max trade amount
            
            // Calculate optimal amount based on balance and max trade size
            const optimalAmount = Math.min(
                balance - 0.0001, // Min balance buffer
                maxAmount
            );
            
            return Math.max(0, optimalAmount);
        } catch (error) {
            console.error("❌ Failed to calculate optimal trade amount:", error);
            throw error;
        }
    }

    async estimateTransactionFee(): Promise<number> {
        try {
            const { blockhash } = await this.connection.getLatestBlockhash();
            const message = new Transaction().add(
                // Add a dummy instruction here
            );
            message.recentBlockhash = blockhash;
            
            const fee = await this.connection.getFeeForMessage(message.compileMessage());
            return Number(fee.value) / 1e9; // Convert to SOL
        } catch (error) {
            console.error("❌ Failed to estimate transaction fee:", error);
            throw error;
        }
    }

    public async getLatestBlockhash() {
        return await this.connection.getLatestBlockhash();
    }

    public getCurrentWallet(): Keypair {
        return this.wallet;
    }

    public setCurrentWallet(wallet: Keypair): void {
        this.wallet = wallet;
    }

    public getPublicKey(): PublicKey {
        return this.wallet.publicKey;
    }

    async getOrCreateTokenAccount(tokenMint: PublicKey): Promise<PublicKey> {
        try {
            // For now, return a placeholder - this would need to be implemented
            // with the new SPL token library API
            console.log(`⚠️ Token account creation not implemented with current SPL token version`);
            throw new Error('Token account creation not implemented with current SPL token version');
        } catch (error) {
            console.error("❌ Failed to get or create token account:", error);
            throw error;
        }
    }

    public getConnection(): Connection {
        return this.connection;
    }

    /**
     * Use Helius Enhanced Transaction API for better confirmation
     */
    async getTransactionStatus(signature: string): Promise<any> {
        try {
            // Extract API key from RPC URL if present
            const apiKey = this.extractApiKeyFromRpcUrl();
            if (!apiKey) {
                throw new Error('Helius API key not found in RPC URL');
            }

            const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    signatures: [signature]
                })
            });

            if (!response.ok) {
                throw new Error(`Helius API error: ${response.statusText}`);
            }

            const data = await response.json() as any[];
            return data[0]; // Return first transaction result
        } catch (error) {
            console.error('Failed to get transaction status from Helius:', error);
            throw error;
        }
    }

    private extractApiKeyFromRpcUrl(): string | null {
        const match = RPC_URL.match(/api-key=([^&]+)/);
        return match ? match[1] : null;
    }

    /**
     * Enhanced transaction confirmation using Helius
     */
    async confirmTransactionWithHelius(signature: string, maxAttempts: number = 10): Promise<boolean> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const txStatus = await this.getTransactionStatus(signature);
                
                if (txStatus && txStatus.confirmationStatus) {
                    console.log(`✅ Transaction confirmed via Helius (attempt ${attempt}): ${signature}`);
                    return true;
                }
                
                console.log(`⏳ Transaction not yet confirmed, attempt ${attempt}/${maxAttempts}`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            } catch (error) {
                console.log(`⚠️ Error checking transaction status (attempt ${attempt}):`, error);
                if (attempt === maxAttempts) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
    }

    /**
     * Get dynamic priority fee based on network congestion using Helius RPC
     */
    public async getDynamicPriorityFee(): Promise<{ computeUnitPrice: number; priorityFee: number }> {
        try {
            // Use Helius RPC method getRecentPrioritizationFees
            const recentFees = await this.connection.getRecentPrioritizationFees({
                lockedWritableAccounts: [this.wallet.publicKey] // Include our wallet for relevant fees
            });

            if (!recentFees || recentFees.length === 0) {
                console.log('⚠️ No recent prioritization fees found, using defaults');
                return {
                    computeUnitPrice: COMPUTE_UNIT_PRICE,
                    priorityFee: 10000
                };
            }

            // Calculate median fee per CU
            const feesPerCu = recentFees.map(fee => {
                const cuLimit = (fee as any).computeUnitLimit || 200000; // Default to 200k if not available
                return fee.prioritizationFee / cuLimit;
            });
            feesPerCu.sort((a, b) => a - b);
            
            const medianFeePerCu = feesPerCu[Math.floor(feesPerCu.length / 2)];
            
            // Add exactly +10% above median
            const competitiveMultiplier = 1.1;
            const dynamicComputeUnitPrice = Math.max(
                Math.floor(medianFeePerCu * competitiveMultiplier),
                COMPUTE_UNIT_PRICE // Never go below minimum
            );
            
            const dynamicPriorityFee = Math.max(
                Math.floor(dynamicComputeUnitPrice * COMPUTE_UNIT_LIMIT),
                10000 // Never go below minimum priority fee
            );

            console.log(`📊 Dynamic Priority Fee: Median=${medianFeePerCu.toFixed(0)}, CU Price=${dynamicComputeUnitPrice}, Priority Fee=${dynamicPriorityFee}, Multiplier=${competitiveMultiplier.toFixed(2)}x`);
            
            return {
                computeUnitPrice: dynamicComputeUnitPrice,
                priorityFee: dynamicPriorityFee
            };
        } catch (error) {
            console.log('⚠️ Failed to get dynamic priority fee, using defaults:', error);
            return {
                computeUnitPrice: COMPUTE_UNIT_PRICE,
                priorityFee: 10000
            };
        }
    }

}

export const walletManager = new WalletManager();