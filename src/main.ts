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
        console.log('Setting up readline interface...');
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
            prompt: '\n> '
        });
        console.log('Readline interface setup complete');
    }

    public setupCommandInput() {
        console.log('\n=== Command Interface Setup ===');
        console.log('Command interface ready. Type a command or !help for options.\n');
        this.rl.prompt();
        this.rl.on('line', async (input) => {
            console.log('\n=== New Input Received ===');
            console.log(`Raw input: ${input}`);
            const trimmedInput = input.trim();
            console.log(`Trimmed input: ${trimmedInput}`);
            if (trimmedInput) {
                try {
                    const command = trimmedInput.startsWith('!') ? trimmedInput : `!${trimmedInput}`;
                    console.log(`Processing command: ${command}`);
                    const response = await commandHandler.handleCommand(command);
                    console.log(`Command handler response: ${response}`);
                    if (response) {
                        console.log('\n=== Command Response ===');
                        console.log(response);
                        console.log('=====================\n');
                    } else {
                        console.log('\nNo response from command handler\n');
                    }
                } catch (error: any) {
                    console.error('\n❌ Error:', error.message, '\n');
                }
            }
            this.rl.prompt();
        });
        console.log('\n=== Available Commands ===');
        console.log('!help - Show this help message');
        console.log('!balance <token_address> - Check token balance');
        console.log('!sell <token_address> <amount> - Sell specific amount');
        console.log('!sellp <token_address> <percentage> - Sell percentage of holdings\n');
        this.rl.prompt();
    }

    public async asyncStartup() {
        try {
            console.log('Launching Sniper bot...');
            // Optionally, you can uncomment the wallet check if you want to enforce it
            // if (!await walletManager.checkMinimumBalance()) {
            //     throw new Error('Insufficient balance');
            // }
            initializeWebSocket();
            this.isRunning = true;
            console.log('Sniper started successfully');
        } catch (error) {
            console.error('Error starting trading bot:', error);
            this.stop();
        }
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
        await this.cancelPendingTransactions();
        console.log("Final wallet balance:", await walletManager.getBalance());
    }

    private async cancelPendingTransactions() {
        try {
            const { blockhash } = await walletManager.getLatestBlockhash();
            const cancelTx = new Transaction().add(
                // Add cancel instruction here
            );
            await walletManager.signAndSendTransaction(cancelTx);
        } catch (error) {
            console.error("❌ Failed to cancel pending transactions:", error);
        }
    }

    private async handleError(error: Error) {
        console.error("❌ Error occurred:", error);
        if (this.isCriticalError(error)) {
            await this.emergencyStop();
        }
    }

    private isCriticalError(error: Error): boolean {
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
bot.setupCommandInput();
bot.asyncStartup();
