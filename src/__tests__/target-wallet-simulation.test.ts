import { TRANSACTION_CONFIG, DEX_CONFIG } from '../config';
import { transactionManager } from '../transaction';
import * as dexModule from '../dex';
import { walletManager } from '../wallet';

// Mock the config for this test suite
jest.mock('../config', () => ({
    ...jest.requireActual('../config'),
    DEX_CONFIG: {
        ...jest.requireActual('../config').DEX_CONFIG,
        maxPriceImpact: 15 // Set slippage tolerance to 15%
    }
}));

// Mock only external dependencies
jest.mock('../wallet', () => ({
    walletManager: {
        checkMinimumBalance: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockReturnValue('mock-public-key'),
        signAndSendTransaction: jest.fn().mockResolvedValue('mock-signature'),
        getBalance: jest.fn().mockResolvedValue(100) // Mock 100 SOL balance
    }
}));

jest.mock('../dex', () => ({
    dexManager: {
        checkLiquidity: jest.fn().mockResolvedValue(true),
        calculatePriceImpact: jest.fn().mockResolvedValue(1),
        executeSwap: jest.fn().mockResolvedValue('mock-signature'),
        getTokenPrice: jest.fn(),
        getTokenBalance: jest.fn().mockResolvedValue(10) // Mock token balance
    }
}));

class TargetWalletSimulator {
    private currentPrice: number;
    private priceHistory: number[];
    private priceUpdateInterval: NodeJS.Timeout | null = null;
    private readonly initialPrice: number;
    private readonly targetWalletAmount: number;
    private readonly botAmount: number;
    private readonly liquidity: number;
    private readonly priceUpdateIntervalMs: number;

    constructor(
        initialPrice: number = 1.0,
        targetWalletAmount: number = 5.0, // Target wallet buys 5 SOL worth
        botAmount: number = 2.0, // Bot buys 2 SOL worth
        liquidity: number = 50,
        priceUpdateIntervalMs: number = 100
    ) {
        this.initialPrice = initialPrice;
        this.currentPrice = initialPrice;
        this.targetWalletAmount = targetWalletAmount;
        this.botAmount = botAmount;
        this.liquidity = liquidity;
        this.priceUpdateIntervalMs = priceUpdateIntervalMs;
        this.priceHistory = [initialPrice];
    }

    simulateTargetWalletTransaction() {
        return new Promise<void>((resolve) => {
            const startTime = Date.now();
            
            this.priceUpdateInterval = setInterval(() => {
                const elapsedTime = Date.now() - startTime;
                
                // Simulate price movement based on target wallet's transaction
                const targetWalletImpact = this.calculatePriceImpact(this.targetWalletAmount);
                const priceMultiplier = 1 + (targetWalletImpact / 100);
                
                // Add some randomness to simulate market dynamics
                const randomFactor = 0.98 + Math.random() * 0.04; // 98-102% of expected price
                this.currentPrice = this.initialPrice * priceMultiplier * randomFactor;
                this.priceHistory.push(this.currentPrice);
                
                // Update DEX mock price
                (dexModule.dexManager.getTokenPrice as jest.Mock).mockResolvedValue(this.currentPrice);
                
                // Stop after 1 second of simulation
                if (elapsedTime >= 1000) {
                    this.stopSimulation();
                    resolve();
                }
            }, this.priceUpdateIntervalMs);
        });
    }

    stopSimulation() {
        if (this.priceUpdateInterval) {
            clearInterval(this.priceUpdateInterval);
            this.priceUpdateInterval = null;
        }
    }

    getCurrentPrice(): number {
        return this.currentPrice;
    }

    getPriceHistory(): number[] {
        return this.priceHistory;
    }

    calculatePriceImpact(amount: number): number {
        // Calculate price impact based on amount and liquidity
        return (amount / this.liquidity) * 100;
    }
}

describe('Target Wallet Transaction Simulation', () => {
    let simulator: TargetWalletSimulator;
    const TEST_TOKEN = 'test-token-123';
    const INITIAL_PRICE = 1.0;
    const TARGET_WALLET_AMOUNT = 5.0; // Target wallet buys 5 SOL worth
    const BOT_AMOUNT = 2.0; // Bot buys 2 SOL worth
    const LIQUIDITY = 50;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Initialize simulator
        simulator = new TargetWalletSimulator(
            INITIAL_PRICE,
            TARGET_WALLET_AMOUNT,
            BOT_AMOUNT,
            LIQUIDITY
        );
        
        // Mock DEX responses
        (dexModule.dexManager.checkLiquidity as jest.Mock).mockResolvedValue(true);
        (dexModule.dexManager.getTokenPrice as jest.Mock).mockResolvedValue(INITIAL_PRICE);
        (dexModule.dexManager.calculatePriceImpact as jest.Mock).mockImplementation(
            (tokenAddress: string, amount: number) => simulator.calculatePriceImpact(Number(amount))
        );
    });

    afterEach(() => {
        simulator.stopSimulation();
    });

    test('Bot executes trade successfully after target wallet transaction', async () => {
        // Start target wallet transaction simulation
        const simulationPromise = simulator.simulateTargetWalletTransaction();

        // Create bot's transaction
        const transaction = {
            signature: 'bot-tx',
            timestamp: Date.now(),
            tokenAddress: TEST_TOKEN,
            amount: BOT_AMOUNT.toString(),
            type: 'buy' as const
        };

        // Execute bot's transaction
        const result = await transactionManager.processTransaction(transaction);
        
        // Wait for simulation to complete
        await simulationPromise;

        // Get final price and impact
        const finalPrice = simulator.getCurrentPrice();
        const priceImpact = simulator.calculatePriceImpact(BOT_AMOUNT);
        
        // Log results
        console.log('\n📊 Target Wallet Simulation Results:');
        console.log(`Initial Price: ${INITIAL_PRICE} SOL`);
        console.log(`Final Price: ${finalPrice} SOL`);
        console.log(`Price Change: ${((finalPrice - INITIAL_PRICE) / INITIAL_PRICE * 100).toFixed(2)}%`);
        console.log(`Target Wallet Amount: ${TARGET_WALLET_AMOUNT} SOL`);
        console.log(`Bot Amount: ${BOT_AMOUNT} SOL`);
        console.log(`Price Impact: ${priceImpact.toFixed(2)}%`);
        console.log(`Max Slippage: ${DEX_CONFIG.maxPriceImpact}%`);
        console.log(`Trade Success: ${result ? '✅' : '❌'}`);

        // Verify results
        expect(result).toBe(true);
        expect(priceImpact).toBeLessThan(DEX_CONFIG.maxPriceImpact);
    });

    test('Bot fails to execute trade when target wallet causes high slippage', async () => {
        // Create simulator with lower liquidity for higher price impact
        const lowLiquiditySimulator = new TargetWalletSimulator(
            INITIAL_PRICE,
            TARGET_WALLET_AMOUNT * 2, // Double the target wallet amount
            BOT_AMOUNT,
            10 // Even lower liquidity
        );

        // Start target wallet transaction simulation
        const simulationPromise = lowLiquiditySimulator.simulateTargetWalletTransaction();

        // Create bot's transaction
        const transaction = {
            signature: 'bot-tx-fail',
            timestamp: Date.now(),
            tokenAddress: TEST_TOKEN,
            amount: BOT_AMOUNT.toString(),
            type: 'buy' as const
        };

        // Execute bot's transaction
        const result = await transactionManager.processTransaction(transaction);
        
        // Wait for simulation to complete
        await simulationPromise;

        // Get final price and impact
        const finalPrice = lowLiquiditySimulator.getCurrentPrice();
        const priceImpact = lowLiquiditySimulator.calculatePriceImpact(BOT_AMOUNT);
        
        // Log results
        console.log('\n📊 Failed Target Wallet Simulation Results:');
        console.log(`Initial Price: ${INITIAL_PRICE} SOL`);
        console.log(`Final Price: ${finalPrice} SOL`);
        console.log(`Price Change: ${((finalPrice - INITIAL_PRICE) / INITIAL_PRICE * 100).toFixed(2)}%`);
        console.log(`Target Wallet Amount: ${TARGET_WALLET_AMOUNT * 2} SOL`);
        console.log(`Bot Amount: ${BOT_AMOUNT} SOL`);
        console.log(`Price Impact: ${priceImpact.toFixed(2)}%`);
        console.log(`Max Slippage: ${DEX_CONFIG.maxPriceImpact}%`);
        console.log(`Trade Success: ${result ? '✅' : '❌'}`);

        // Verify results
        expect(result).toBe(false);
        expect(priceImpact).toBeGreaterThan(DEX_CONFIG.maxPriceImpact);
    });
}); 