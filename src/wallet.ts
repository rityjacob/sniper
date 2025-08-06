import { 
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    VersionedTransaction
} from '@solana/web3.js';
import { 
    WALLET_PRIVATE_KEY,
    TRANSACTION_CONFIG,
    NETWORK,
    RPC_URL
} from './config';
import bs58 from 'bs58';
import * as fs from 'fs';
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
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
        return balance >= TRANSACTION_CONFIG.minSolBalance;
    }

    async signAndSendTransaction(transaction: Transaction | VersionedTransaction): Promise<string> {
        try {
            console.log('\n🔐 === SIGNING AND SENDING TRANSACTION ===');
            console.log('📋 Transaction Type:', transaction instanceof Transaction ? 'Legacy' : 'Versioned');
            console.log('⚙️  Compute Unit Limit:', TRANSACTION_CONFIG.computeUnitLimit);
            console.log('⚙️  Compute Unit Price:', TRANSACTION_CONFIG.computeUnitPrice);
            console.log('💰 Priority Fee:', TRANSACTION_CONFIG.priorityFee, 'lamports');
            
            // Get latest blockhash
            console.log('📡 Getting latest blockhash...');
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            console.log('✅ Blockhash received:', blockhash.substring(0, 8) + '...');

            if (transaction instanceof Transaction) {
                console.log('🔧 Processing Legacy Transaction...');
                // Handle legacy transaction
                transaction.recentBlockhash = blockhash;
                
                // Add compute unit instructions for legacy transactions
                const { ComputeBudgetProgram } = await import('@solana/web3.js');
                const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
                    units: TRANSACTION_CONFIG.computeUnitLimit
                });
                const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: TRANSACTION_CONFIG.computeUnitPrice
                });
                
                console.log('⚙️  Adding compute unit instructions...');
                transaction.add(modifyComputeUnits, addPriorityFee);
                console.log('✍️  Signing transaction...');
                transaction.sign(this.wallet);
                console.log('✅ Legacy transaction signed');
            } else {
                console.log('🔧 Processing Versioned Transaction...');
                // Handle versioned transaction
                console.log('✍️  Signing versioned transaction...');
                transaction.sign([this.wallet]);
                console.log('✅ Versioned transaction signed');
            }

            // Send transaction
            console.log('📤 Sending transaction to network...');
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: false,
                    maxRetries: TRANSACTION_CONFIG.maxRetries,
                    preflightCommitment: 'confirmed'
                }
            );
            console.log('✅ Transaction sent successfully');
            console.log('🔍 Signature:', signature);

            // Wait for confirmation
            console.log('⏳ Waiting for transaction confirmation...');
            const confirmation = await this.connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            }, 'confirmed');

            console.log('📊 Confirmation Result:');
            console.log('   - Error:', confirmation.value.err);
            console.log('   - Context:', confirmation.context);

            if (confirmation.value.err) {
                console.log('❌ TRANSACTION CONFIRMATION FAILED:');
                console.log('   - Error:', confirmation.value.err);
                console.log('   - Signature:', signature);
                console.log('   - Blockhash:', blockhash);
                throw new Error('Transaction confirmation failed');
            }
            
            console.log('✅ TRANSACTION CONFIRMED SUCCESSFULLY');
            console.log('🎉 Final Signature:', signature);
            return signature;
        } catch (error: any) {
            console.log('❌ TRANSACTION FAILED:');
            console.log('   - Error Type:', error.constructor.name);
            console.log('   - Error Message:', error.message);
            console.log('   - Error Stack:', error.stack);
            logger.logError('wallet', 'Transaction failed', error.message);
            throw error;
        }
    }

    async calculateOptimalTradeAmount(tokenAddress: string): Promise<number> {
        try {
            const balance = await this.getBalance();
            const maxAmount = TRANSACTION_CONFIG.maxSolPerTrade;
            
            // Calculate optimal amount based on balance and max trade size
            const optimalAmount = Math.min(
                balance - TRANSACTION_CONFIG.minSolBalance,
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
            // Get the associated token account address
            const tokenAccount = await getAssociatedTokenAddress(
                tokenMint,
                this.wallet.publicKey
            );

            // Check if the account exists
            const accountInfo = await this.connection.getAccountInfo(tokenAccount);
            
            if (!accountInfo) {
                // Create the account if it doesn't exist
                const createAccountTx = new Transaction().add(
                    createAssociatedTokenAccountInstruction(
                        this.wallet.publicKey,
                        tokenAccount,
                        this.wallet.publicKey,
                        tokenMint
                    )
                );

                await this.signAndSendTransaction(createAccountTx);
                console.log(`✅ Created token account: ${tokenAccount.toString()}`);
            }

            return tokenAccount;
        } catch (error) {
            console.error("❌ Failed to get or create token account:", error);
            throw error;
        }
    }

    public getConnection(): Connection {
        return this.connection;
    }
}

export const walletManager = new WalletManager();