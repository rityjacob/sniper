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
import { commandHandler } from './commands';
import * as readline from 'readline';

class Sniper {
    private isRunning: boolean = false;
    private rl: readline.Interface;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async start() {
        try {
            console.log('Launching Sniper bot...');

            if (!await walletManager.checkMinimumBalance()) {
                throw new Error('Insufficient balance');
            }

            // Set up command input first
            this.setupCommandInput();
            
            // Then initialize WebSocket
            initializeWebSocket();

            this.isRunning = true;
            console.log('Sniper started successfully');
        } catch (error) {
            console.error('Error starting trading bot:', error);
            this.stop();
        }
    }

    private setupCommandInput() {
        console.log('\nCommand interface ready. Type a command or !help for options.\n');
        
        this.rl.on('line', async (input) => {
            const trimmedInput = input.trim();
            if (trimmedInput) {
                try {
                    // Add ! prefix if missing
                    const command = trimmedInput.startsWith('!') ? trimmedInput : `!${trimmedInput}`;
                    console.log(`Processing command: ${command}`);
                    
                    const response = await commandHandler.handleCommand(command);
                    if (response) {
                        console.log('\n' + response + '\n');
                    } else {
                        console.log('\nNo response from command handler\n');
                    }
                } catch (error: any) {
                    console.error('\n❌ Error:', error.message, '\n');
                }
            }
        });

        // Show initial help message
        console.log('\nAvailable commands:');
        console.log('!help - Show this help message');
        console.log('!balance <token_address> - Check token balance');
        console.log('!sell <token_address> <amount> - Sell specific amount');
        console.log('!sellp <token_address> <percentage> - Sell percentage of holdings\n');
    }

    stop() {
        this.isRunning = false;
        this.rl.close();
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
