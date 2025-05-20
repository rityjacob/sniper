import { 
    TARGET_WALLET_ADDRESS,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG,
    MONITORING_CONFIG 
} from './config.js';
import { initializeWebSocket } from './websocket.js';
import { transactionManager } from './transaction.js';
import { dexManager } from './dex.js';
import { walletManager } from './wallet.js';

class Sniper {
    private isRunning: boolean = false;

    async start() {
        try {
            console.log('Starting trading bot...');

            if (!await walletManager.checkMinimumBalance()) {
                throw new Error('Insufficient balance');
            }
            initializeWebSocket();

            this.isRunning = true;
            console.log('Trading bot started successfully');
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

}

const bot = new Sniper();

bot.start().catch(console.error);
