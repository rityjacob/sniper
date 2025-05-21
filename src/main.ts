import 'dotenv/config';
import { 
    TARGET_WALLET_ADDRESS,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG,
    MONITORING_CONFIG 
} from './config';
import { initializeWebSocket } from './websocket';
import { transactionManager } from './transaction';
import { dexManager } from './dex';
import { walletManager } from './wallet';
import { Transaction } from '@solana/web3.js';

class Sniper {
    private isRunning: boolean = false;

    async start() {
        try {
            console.log('Launching Sniper bot...');

            if (!await walletManager.checkMinimumBalance()) {
                throw new Error('Insufficient balance');
            }
            initializeWebSocket();

            this.isRunning = true;
            console.log('Sniper started successfully');
        } catch (error) {
            console.error('Error starting trading bot:', error);
            this.stop;
        }
    }

    stop() {
        this.isRunning = false;
        console.log('Trading bot stopped');
    }

    async handleTransaction(transaction: any) {
        if (!this.isRunning) return;

        try {
            const success = await transactionManager.processTransaction(transaction);

            if (success) {
                await dexManager.executeSwap(
                    transaction.tokenAddress,
                    transaction.amount
                );
            }
        } catch (error) {
            console.error('Error handling transaction:', error);
        }
    }

    private async emergencyStop() {
        console.log("🛑 Emergency stop triggered!");
        this.stop();
        
        // Cancel any pending transactions
        await this.cancelPendingTransactions();
        
        // Log final state
        console.log("Final wallet balance:", await walletManager.getBalance());
    }

    private async cancelPendingTransactions() {
        try {
            // Get recent blockhash
            const { blockhash } = await walletManager.getLatestBlockhash();
            
            // Create cancel transaction
            const cancelTx = new Transaction().add(
                // Add cancel instruction here
            );
            
            // Send cancel transaction
            await walletManager.signAndSendTransaction(cancelTx);
        } catch (error) {
            console.error("❌ Failed to cancel pending transactions:", error);
        }
    }

    private async handleError(error: Error) {
        console.error("❌ Error occurred:", error);
        
        // Check if error is critical
        if (this.isCriticalError(error)) {
            await this.emergencyStop();
        }
    }

    private isCriticalError(error: Error): boolean {
        // Define what constitutes a critical error
        const criticalErrors = [
            "insufficient funds",
            "invalid transaction",
            "connection lost"
        ];
        
        return criticalErrors.some(msg => 
            error.message.toLowerCase().includes(msg)
        );
    }
}

const bot = new Sniper();

bot.start().catch(console.error);
