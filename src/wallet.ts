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
} from './config.js';
import bs58 from 'bs58';

class WalletManager {
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
            // Add priority fee
            transaction.recentBlockhash = (
                await this.connection.getLatestBlockhash()
            ).blockhash;
            
            // Sign transaction
            transaction.sign(this.wallet);

            // Send transaction
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: false,
                    maxRetries: TRANSACTION_CONFIG.maxRetries
                }
            );

            // Wait for confirmation
            await this.connection.confirmTransaction({
                signature,
                blockhash: (await this.connection.getLatestBlockhash()).blockhash,
                lastValidBlockHeight: (await this.connection.getLatestBlockhash()).lastValidBlockHeight
            }, 'confirmed');

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
            
            return optimalAmount;
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
            return Number(fee) / 1e9; // Convert to SOL
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