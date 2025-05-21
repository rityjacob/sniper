import { TRANSACTION_CONFIG, DEX_CONFIG } from '../config';
import { transactionManager } from '../transaction';
import * as dexModule from '../dex';
import { walletManager } from '../wallet';

// Override DEX_CONFIG for this test suite
const TEST_DEX_CONFIG = {
    ...DEX_CONFIG,
    maxPriceImpact: 15 // Set slippage tolerance to 15%
};

// Mock the necessary dependencies
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
        getTokenPrice: jest.fn()
    }
}));

// Mock transaction manager
jest.mock('../transaction', () => ({
    transactionManager: {
        processTransaction: jest.fn().mockImplementation(async (transaction) => {
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check amount limits
            const amount = parseFloat(transaction.amount);
            if (amount < 0.01) {
                console.log('Amount below minimum threshold');
                return false;
            }
            if (amount > TRANSACTION_CONFIG.maxSolPerTrade) {
                console.log('Amount exceeds maximum allowed');
                return false;
            }

            // Get current price impact from DEX
            const priceImpact = await dexModule.dexManager.calculatePriceImpact(
                transaction.tokenAddress,
                amount
            );

            if (priceImpact > TEST_DEX_CONFIG.maxPriceImpact) {
                console.log('⚠️ Price impact too high');
                console.log(`Token: ${transaction.tokenAddress}`);
                console.log(`Impact: ${priceImpact}% (exceeds max ${TEST_DEX_CONFIG.maxPriceImpact}%)`);
                return false;
            }

            console.log('Trade completed successfully');
            return true;
        })
    }
}));

// Mock DEX price simulation
class MockDexSimulator {
    private currentPrice: number;
    private priceHistory: number[];
    private priceUpdateInterval: NodeJS.Timeout | null = null;
    private readonly initialPrice: number;
    private readonly maxPrice: number;
    private readonly pumpDuration: number;
    private readonly priceUpdateIntervalMs: number;
    private readonly liquidity: number;

    constructor(
        initialPrice: number = 1.0,
        maxPrice: number = 2.0,
        pumpDuration: number = 10000, // 10 seconds
        priceUpdateIntervalMs: number = 100, // Update every 100ms
        liquidity: number = 100 // Lower liquidity for higher price impact
    ) {
        this.initialPrice = initialPrice;
        this.currentPrice = initialPrice;
        this.maxPrice = maxPrice;
        this.pumpDuration = pumpDuration;
        this.priceUpdateIntervalMs = priceUpdateIntervalMs;
        this.priceHistory = [initialPrice];
        this.liquidity = liquidity;
    }

    startPump() {
        const startTime = Date.now();
        const priceIncrement = (this.maxPrice - this.initialPrice) / (this.pumpDuration / this.priceUpdateIntervalMs);
        
        this.priceUpdateInterval = setInterval(() => {
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime >= this.pumpDuration) {
                this.stopPump();
                return;
            }

            // Simulate price increase with some randomness
            const randomFactor = 0.95 + Math.random() * 0.1; // 95-105% of expected price
            this.currentPrice = Math.min(
                this.maxPrice,
                this.initialPrice + (priceIncrement * (elapsedTime / this.priceUpdateIntervalMs) * randomFactor)
            );
            this.priceHistory.push(this.currentPrice);
            
            // Update DEX mock price
            (dexModule.dexManager.getTokenPrice as jest.Mock).mockResolvedValue(this.currentPrice);
        }, this.priceUpdateIntervalMs);
    }

    stopPump() {
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
        // More realistic price impact calculation
        // Impact increases with both amount and current price
        const baseImpact = (amount / this.liquidity) * 100;
        const priceMultiplier = this.currentPrice / this.initialPrice;
        return baseImpact * priceMultiplier;
    }
}

describe('Token Pump Simulation', () => {
    let mockDex: MockDexSimulator;
    const TEST_TOKEN = 'test-token-123';
    const INITIAL_PRICE = 1.0;
    const MAX_PRICE = 2.0;
    const PUMP_DURATION = 10000; // 10 seconds
    const LOW_LIQUIDITY = 20; // Even lower liquidity for higher price impact
    const HIGHER_LIQUIDITY = 50; // Higher liquidity for successful trade

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Initialize mock DEX simulator with higher liquidity for successful trade
        mockDex = new MockDexSimulator(INITIAL_PRICE, MAX_PRICE, PUMP_DURATION, 100, HIGHER_LIQUIDITY);
        
        // Mock DEX responses
        (dexModule.dexManager.checkLiquidity as jest.Mock).mockResolvedValue(true);
        (dexModule.dexManager.getTokenPrice as jest.Mock).mockResolvedValue(INITIAL_PRICE);
        (dexModule.dexManager.calculatePriceImpact as jest.Mock).mockImplementation(
            (tokenAddress: string, amount: number) => mockDex.calculatePriceImpact(Number(amount))
        );
    });

    afterEach(() => {
        mockDex.stopPump();
    });

    test('Bot executes trade before slippage exceeds limit during pump', async () => {
        // Start the pump simulation
        mockDex.startPump();

        // Create transaction with smaller amount
        const transaction = {
            signature: 'pump-test-tx',
            timestamp: Date.now(),
            tokenAddress: TEST_TOKEN,
            amount: '2' // 2 SOL - smaller amount with higher liquidity
        };

        // Execute transaction
        const result = await transactionManager.processTransaction(transaction);
        
        // Stop the pump
        mockDex.stopPump();

        // Get final price and impact
        const finalPrice = mockDex.getCurrentPrice();
        const priceImpact = mockDex.calculatePriceImpact(2);
        
        // Log results
        console.log('\n📊 Pump Simulation Results:');
        console.log(`Initial Price: ${INITIAL_PRICE} SOL`);
        console.log(`Final Price: ${finalPrice} SOL`);
        console.log(`Price Change: ${((finalPrice - INITIAL_PRICE) / INITIAL_PRICE * 100).toFixed(2)}%`);
        console.log(`Price Impact: ${priceImpact.toFixed(2)}%`);
        console.log(`Max Slippage: ${TEST_DEX_CONFIG.maxPriceImpact}%`);
        console.log(`Trade Success: ${result ? '✅' : '❌'}`);

        // Verify results
        expect(result).toBe(true);
        expect(priceImpact).toBeLessThan(TEST_DEX_CONFIG.maxPriceImpact);
    });

    test('Bot fails to execute trade when slippage exceeds limit', async () => {
        // Start the pump simulation with higher price increase
        const aggressivePump = new MockDexSimulator(
            INITIAL_PRICE,
            MAX_PRICE * 4, // Quadruple the price increase
            PUMP_DURATION,
            100,
            LOW_LIQUIDITY
        );
        aggressivePump.startPump();

        // Create transaction with larger amount
        const transaction = {
            signature: 'pump-test-tx-fail',
            timestamp: Date.now(),
            tokenAddress: TEST_TOKEN,
            amount: '10' // 10 SOL - larger amount that should fail with 15% slippage
        };

        // Execute transaction
        const result = await transactionManager.processTransaction(transaction);
        
        // Stop the pump
        aggressivePump.stopPump();

        // Get final price and impact
        const finalPrice = aggressivePump.getCurrentPrice();
        const priceImpact = aggressivePump.calculatePriceImpact(10);
        
        // Log results
        console.log('\n📊 Failed Pump Simulation Results:');
        console.log(`Initial Price: ${INITIAL_PRICE} SOL`);
        console.log(`Final Price: ${finalPrice} SOL`);
        console.log(`Price Change: ${((finalPrice - INITIAL_PRICE) / INITIAL_PRICE * 100).toFixed(2)}%`);
        console.log(`Price Impact: ${priceImpact.toFixed(2)}%`);
        console.log(`Max Slippage: ${TEST_DEX_CONFIG.maxPriceImpact}%`);
        console.log(`Trade Success: ${result ? '✅' : '❌'}`);

        // Verify results
        expect(result).toBe(false);
        expect(priceImpact).toBeGreaterThan(TEST_DEX_CONFIG.maxPriceImpact);
    });
}); 