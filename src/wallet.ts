import { 
    Connection,
    Keypair,
    PublicKey,
    Transaction
} from '@solana/web3.js';
import { 
    WALLET_PRIVATE_KEY,
    TRANSACTION_CONFIG,
    NETWORK,
    RPC_URL
} from './config';
import bs58 from 'bs58';

export class WalletManager {
    private connection: Connection;
    private wallet: Keypair;

    constructor() {
        this.connection = new Connection(RPC_URL);
        this.wallet = this.initializeWallet();
    }

    private initializeWallet(): Keypair {
        try {
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

    async signAndSendTransaction(transaction: Transaction): Promise<string> {
        try {
            // Get latest blockhash
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;

            // Add priority fee
            const priorityFee = TRANSACTION_CONFIG.priorityFee;
            console.log(`💰 Adding priority fee: ${priorityFee} lamports`);

            // Sign transaction
            transaction.sign(this.wallet);

            // Send transaction with priority fee
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: false,
                    maxRetries: TRANSACTION_CONFIG.maxRetries,
                    preflightCommitment: 'confirmed'
                }
            );

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            }, 'confirmed');

            if (confirmation.value.err) {
                throw new Error('Transaction confirmation failed');
            }

            console.log(`✅ Transaction confirmed: ${signature}`);
            return signature;
        } catch (error) {
            console.error("❌ Transaction failed:", error);
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
    public getPublicKey(): PublicKey {
        return this.wallet.publicKey;
    }
}

export const walletManager = new WalletManager();