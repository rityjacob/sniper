declare global {
    interface Global {
        fetch: jest.Mock;
    }
}

let mockTokenBalance = 1000;

// @ts-ignore
global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
    // Handle balance check - match the exact URL pattern from dex.ts
    if (url.includes('/balance') && url.includes('token=')) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ balance: mockTokenBalance })
        });
    }

    // Handle quote request (POST)
    if (url.includes('/quote')) {
        if (options?.method !== 'POST') {
            return Promise.resolve({
                ok: false,
                status: 405,
                statusText: 'Method Not Allowed'
            });
        }
        const body = JSON.parse(options.body);
        // Match the exact structure from dex.ts
        if (!body.inputMint || !body.outputMint || !body.amount || !body.slippageBps) {
            return Promise.resolve({
                ok: false,
                status: 400,
                statusText: 'Bad Request'
            });
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                outAmount: '1000000000',
                inAmount: '1000000000',
                priceImpactPct: 0.1,
                marketInfos: [{
                    label: 'Jupiter',
                    lpFee: { amount: '0', mint: 'SOL' }
                }]
            })
        });
    }

    // Handle swap request (POST)
    if (url.includes('/swap')) {
        if (options?.method !== 'POST') {
            return Promise.resolve({
                ok: false,
                status: 405,
                statusText: 'Method Not Allowed'
            });
        }
        const body = JSON.parse(options.body);
        // Match the exact structure from dex.ts
        if (!body.quoteResponse || !body.userPublicKey || !body.wrapUnwrapSOL) {
            return Promise.resolve({
                ok: false,
                status: 400,
                statusText: 'Bad Request'
            });
        }
        mockTokenBalance = 0; // Update balance after swap
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                swapTransaction: 'mock_transaction'
            })
        });
    }

    // Handle price check
    if (url.includes('/price')) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ price: 1.0 })
        });
    }

    // Handle liquidity check
    if (url.includes('/liquidity')) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ liquidity: 1000 })
        });
    }

    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
    });
});

// Set up mocks before any imports
jest.mock('node-fetch', () => {
    const originalModule = jest.requireActual('node-fetch');
    return {
        __esModule: true,
        ...originalModule,
        default: jest.fn().mockImplementation((url: string, options?: any) => {
            // Handle balance check
            if (url.includes('/balance')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ balance: 1000 })
                });
            }

            // Handle quote request
            if (url.includes('/quote')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        outAmount: '1000000000',
                        inAmount: '1000000000',
                        priceImpactPct: 0.1,
                        marketInfos: [{
                            label: 'Jupiter',
                            lpFee: { amount: '0', mint: 'SOL' }
                        }]
                    })
                });
            }

            // Handle swap request
            if (url.includes('/swap')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        swapTransaction: 'mock_transaction'
                    })
                });
            }

            // Handle price check
            if (url.includes('/price')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ price: 1.0 })
                });
            }

            // Handle liquidity check
            if (url.includes('/liquidity')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ liquidity: 1000 })
                });
            }

            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({})
            });
        })
    };
});

// Now import the modules
import { commandHandler } from '../commands';
import { dexManager } from '../dex';
import { logger } from '../utils/logger';

// Mock the wallet
jest.mock('../wallet', () => ({
    walletManager: {
        getPublicKey: () => ({
            toString: () => 'So11111111111111111111111111111111111111112'
        }),
        signAndSendTransaction: async (transaction: any) => {
            console.log('Mock transaction:', transaction);
            return 'mock_signature_' + Math.random().toString(36).substring(7);
        }
    }
}));

describe('Command Handler Integration Tests', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';

    beforeEach(() => {
        jest.clearAllMocks();
        mockTokenBalance = 1000; // Reset balance before each test
    });

    it('should handle balance check command', async () => {
        const response = await commandHandler.handleCommand(`!balance ${tokenAddress}`);
        expect(response).toContain('Current balance: 1000');
    });

    it('should handle sell percentage command', async () => {
        const response = await commandHandler.handleCommand(`!sellp ${tokenAddress} 50`);
        expect(response).toMatch(/Successfully sold|Sell failed/);
    });

    it('should handle sell amount command', async () => {
        const response = await commandHandler.handleCommand(`!sell ${tokenAddress} 1000`);
        expect(response).toMatch(/Sell successful|Sell failed/);
    });

    it('should handle help command', async () => {
        const response = await commandHandler.handleCommand('!help');
        expect(response).toContain('Available commands:');
    });

    it('should handle invalid command', async () => {
        const response = await commandHandler.handleCommand('!invalid');
        expect(response).toContain('Unknown command');
    });

    it('should handle invalid sell amount', async () => {
        const response = await commandHandler.handleCommand(`!sell ${tokenAddress} -100`);
        expect(response).toContain('Invalid amount');
    });

    it('should handle invalid sell percentage', async () => {
        const response = await commandHandler.handleCommand(`!sellp ${tokenAddress} 150`);
        expect(response).toContain('Invalid percentage');
    });

    it('should handle missing arguments', async () => {
        const response = await commandHandler.handleCommand('!sell');
        expect(response).toContain('Usage:');
    });

    describe('Token Purchase and Sell Flow', () => {
        it('should simulate complete buy and sell flow', async () => {
            // Simulate token purchase
            const buyAmount = 1;
            const buySignature = await dexManager.executeSwap(tokenAddress, buyAmount);
            expect(buySignature).toMatch(/mock_signature_/);

            // Check balance
            const balanceResponse = await commandHandler.handleCommand(`!balance ${tokenAddress}`);
            expect(balanceResponse).toContain('Current balance: 1000');

            // Sell percentage
            const sellPercentageResponse = await commandHandler.handleCommand(`!sellp ${tokenAddress} 50`);
            expect(sellPercentageResponse).toMatch(/Successfully sold|Sell failed/);

            // Sell specific amount
            const sellAmountResponse = await commandHandler.handleCommand(`!sell ${tokenAddress} 500`);
            expect(sellAmountResponse).toMatch(/Sell successful|Sell failed/);
        });
    });
});

// async function simulateBotBehavior() {
//     console.log('🤖 Starting bot simulation...\n');

//     // Simulate a token purchase
//     const tokenAddress = 'So11111111111111111111111111111111111111112'; // Example token address
//     const buyAmount = 1; // SOL

//     try {
//         console.log('📥 Simulating token purchase...');
//         const buySignature = await dexManager.executeSwap(tokenAddress, buyAmount);
//         console.log(`✅ Token purchased successfully!`);
//         console.log(`Token Address: ${tokenAddress}`);
//         console.log(`Amount: ${buyAmount} SOL`);
//         console.log(`Transaction Signature: ${buySignature}\n`);

//         // Wait for user input to sell
//         console.log('⏳ Waiting for sell command...');
//         console.log('Type one of the following commands to sell:');
//         console.log(`1. !sell ${tokenAddress} <amount>`);
//         console.log(`2. !sellp ${tokenAddress} <percentage>`);
//         console.log('3. !balance ' + tokenAddress + ' (to check balance)');
//         console.log('4. !help (to see all commands)\n');

//         // Simulate command handling
//         const testCommands = [
//             `!balance ${tokenAddress}`,
//             `!sellp ${tokenAddress} 50`,
//             `!sell ${tokenAddress} 1000`,
//             '!help'
//         ];

//         for (const command of testCommands) {
//             console.log(`\n📝 Testing command: ${command}`);
//             const response = await commandHandler.handleCommand(command);
//             console.log('📤 Response:');
//             console.log(response);
//             console.log('\n' + '─'.repeat(50));
//         }

//     } catch (error: any) {
//         console.error('❌ Error in simulation:', error.message);
//     }
// }

// Run the simulation
// simulateBotBehavior().catch(console.error); 