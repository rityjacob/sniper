import { dexManager } from './dex';
import { logger } from './utils/logger';
import { walletManager } from './wallet';

interface Command {
    name: string;
    description: string;
    usage: string;
    execute: (args: string[]) => Promise<string>;
}

class CommandHandler {
    private commands: Map<string, Command> = new Map();

    constructor() {
        console.log('Initializing CommandHandler...');
        this.registerCommands();
        console.log('CommandHandler initialized with commands:', Array.from(this.commands.keys()));
    }

    private registerCommands() {
        console.log('Registering commands...');
        // Sell specific amount command
        this.commands.set('sell', {
            name: 'sell',
            description: 'Sell a specific amount of tokens',
            usage: '!sell <token_address> <amount>',
            execute: async (args: string[]) => {
                if (args.length !== 2) {
                    return `Usage: ${this.commands.get('sell')?.usage}`;
                }

                const [tokenAddress, amount] = args;
                const tokenAmount = parseInt(amount);

                if (isNaN(tokenAmount) || tokenAmount <= 0) {
                    return 'Invalid amount. Please provide a positive number.';
                }

                try {
                    // Check balance first
                    const balance = await dexManager.getTokenBalance(tokenAddress);
                    if (balance < tokenAmount) {
                        return `Insufficient balance. You have ${balance} tokens.`;
                    }

                    // Calculate expected return
                    const expectedReturn = await dexManager.calculateExpectedReturn(tokenAddress, tokenAmount);
                    const response = `Expected to receive: ${expectedReturn.expectedSol.toFixed(4)} SOL\n` +
                        `Price impact: ${expectedReturn.priceImpact.toFixed(2)}%\n` +
                        `Minimum you'll receive: ${expectedReturn.minimumReceived.toFixed(4)} SOL\n` +
                        `Proceeding with sell...`;

                    // Execute sell
                    const signature = await dexManager.sellToken(tokenAddress, tokenAmount);
                    return `${response}\nSell successful! Signature: ${signature}`;
                } catch (error: any) {
                    return `Sell failed: ${error.message}`;
                }
            }
        });

        // Sell percentage command
        this.commands.set('sellp', {
            name: 'sellp',
            description: 'Sell a percentage of your token holdings',
            usage: '!sellp <token_address> <percentage>',
            execute: async (args: string[]) => {
                if (args.length !== 2) {
                    return `Usage: ${this.commands.get('sellp')?.usage}`;
                }

                const [tokenAddress, percentage] = args;
                const percent = parseFloat(percentage);

                if (isNaN(percent) || percent <= 0 || percent > 100) {
                    return 'Invalid percentage. Please provide a number between 0 and 100.';
                }

                try {
                    const signature = await dexManager.sellPercentageOfHoldings(tokenAddress, percent);
                    return `Successfully sold ${percent}% of holdings! Signature: ${signature}`;
                } catch (error: any) {
                    return `Sell failed: ${error.message}`;
                }
            }
        });

        // Check balance command
        this.commands.set('balance', {
            name: 'balance',
            description: 'Check SOL or token balance',
            usage: '!balance [token_address]',
            execute: async (args: string[]) => {
                if (args.length === 0) {
                    try {
                        const solBalance = await walletManager.getBalance();
                        return `\n💰  Wallet SOL Balance\n----------------------\n  ${solBalance} SOL\n`;
                    } catch (error: any) {
                        return `\n❌ Failed to fetch SOL balance: ${error.message}\n`;
                    }
                }
                if (args.length === 1) {
                    const [tokenAddress] = args;
                    try {
                        const balance = await dexManager.getTokenBalance(tokenAddress);
                        return `\n💰  Token Balance\n----------------------\n  ${balance} tokens\n`;
                    } catch (error: any) {
                        return `\n❌ Failed to fetch token balance: ${error.message}\n`;
                    }
                }
                return `\nUsage: ${this.commands.get('balance')?.usage}\n`;
            }
        });

        // Help command
        this.commands.set('help', {
            name: 'help',
            description: 'Show available commands',
            usage: '!help',
            execute: async () => {
                let helpText = '\n📖  Available Commands\n----------------------';
                this.commands.forEach(cmd => {
                    helpText += `\n\n${cmd.usage}\n  ${cmd.description}`;
                });
                helpText += '\n';
                return helpText;
            }
        });
    }

    async handleCommand(message: string): Promise<string> {
        if (!message.startsWith('!')) {
            return '';
        }

        const [command, ...args] = message.slice(1).split(' ');
        const cmd = this.commands.get(command.toLowerCase());

        if (!cmd) {
            return `Unknown command. Type !help for available commands.`;
        }

        try {
            const result = await cmd.execute(args);
            return result;
        } catch (error: any) {
            logger.logError('system', 'Command execution failed', error.message);
            return `Command failed: ${error.message}`;
        }
    }
}

export const commandHandler = new CommandHandler(); 