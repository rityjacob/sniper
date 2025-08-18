import { dexManager } from '../dex';
import { PumpFunWebhook } from '../types';

// Mock the wallet manager
jest.mock('../wallet', () => ({
    walletManager: {
        getConnection: jest.fn(() => ({
            getLatestBlockhash: jest.fn(() => Promise.resolve({ blockhash: 'test-blockhash' }))
        })),
        getPublicKey: jest.fn(() => 'test-public-key'),
        getBalance: jest.fn(() => Promise.resolve(1.0)), // 1 SOL balance
        signAndSendTransaction: jest.fn(() => Promise.resolve('test-signature'))
    }
}));

// Mock the logger
jest.mock('../utils/logger', () => ({
    logger: {
        logInfo: jest.fn(),
        logError: jest.fn(),
        logTransaction: jest.fn(),
        logWarning: jest.fn()
    }
}));

describe('Pump.fun DEX Manager', () => {
    const mockWebhookData: PumpFunWebhook = {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: '1000000000', // 1 SOL in lamports
        accounts: [
            '11111111111111111111111111111112', // Valid base58 address
            '22222222222222222222222222222222', // Valid base58 address
            '33333333333333333333333333333333'  // Valid base58 address
        ],
        programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
        data: 'dGVzdC1kYXRh' // "test-data" in base64
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('processWebhookAndSwap', () => {
        it('should throw error for invalid program ID', async () => {
            const invalidWebhook = {
                ...mockWebhookData,
                programId: 'invalid-program-id'
            };

            await expect(dexManager.processLeaderBuyWebhook(invalidWebhook, 0.1))
                .rejects.toThrow('Invalid Pump.fun program ID');
        });
    });

    describe('getTokenPrice', () => {
        it('should return a placeholder price', async () => {
            const price = await dexManager.getTokenPrice('test-token');
            expect(price).toBe(0.001); // Placeholder price
        });
    });

    describe('checkLiquidity', () => {
        it('should return true for liquidity check', async () => {
            const hasLiquidity = await dexManager.checkLiquidity('test-token');
            expect(hasLiquidity).toBe(true);
        });
    });

    describe('calculatePriceImpact', () => {
        it('should calculate price impact', async () => {
            const impact = await dexManager.calculatePriceImpact('test-token', 0.1);
            expect(impact).toBeGreaterThan(0);
        });
    });

    describe('calculateExpectedReturn', () => {
        it('should calculate expected return', async () => {
            const result = await dexManager.calculateExpectedReturn('test-token', 100);
            expect(result).toHaveProperty('expectedSol');
            expect(result).toHaveProperty('priceImpact');
            expect(result).toHaveProperty('minimumReceived');
        });
    });

    describe('sellPercentageOfHoldings', () => {
        it('should throw error for invalid percentage', async () => {
            await expect(dexManager.sellPercentageOfHoldings('test-token', 150))
                .rejects.toThrow('Percentage must be between 0 and 100');
        });

        it('should throw error for zero percentage', async () => {
            await expect(dexManager.sellPercentageOfHoldings('test-token', 0))
                .rejects.toThrow('Percentage must be between 0 and 100');
        });
    });
});
