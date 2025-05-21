// Mock node-fetch at the very top
jest.mock('node-fetch', () => jest.fn());

// Mock wallet before importing dex
jest.mock('../wallet', () => ({
    walletManager: {
        getPublicKey: () => ({
            toString: () => 'So11111111111111111111111111111111111111112'
        }),
        signAndSendTransaction: jest.fn().mockResolvedValue('mock_signature')
    }
}));

import { dexManager } from '../dex';
import fetch from 'node-fetch';
import { logger } from '../utils/logger';

const mockFetch = fetch as unknown as jest.Mock;

// Mock logger
jest.mock('../utils/logger', () => ({
    logger: {
        logInfo: jest.fn(),
        logError: jest.fn(),
        logWarning: jest.fn(),
        logTransactionSuccess: jest.fn(),
        logTransactionFailure: jest.fn()
    }
}));

describe('DexManager - calculateExpectedReturn', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const tokenAmount = 1000;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should calculate expected return successfully', async () => {
        const mockQuote = {
            outAmount: '1000000000',
            inAmount: '1000000000'
        };
        const mockPrice = 1.0;
        const mockLiquidity = 10000;

        // Mock the quote API call
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuote)
            })
            // Mock the price API call
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ price: mockPrice })
            })
            // Mock the liquidity API call
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ liquidity: mockLiquidity })
            });

        const result = await dexManager.calculateExpectedReturn(tokenAddress, tokenAmount);
        expect(result.expectedSol).toBe(1); // 1000000000 / 1e9
        expect(result.priceImpact).toBe(10); // (1000 / 10000) * 100
        expect(result.minimumReceived).toBe(0.8); // 1000000000 * (1 - 0.2) / 1e9
    });

    it('should handle API error', async () => {
        const errorMessage = 'API error';
        mockFetch.mockRejectedValueOnce(new Error(errorMessage));

        await expect(dexManager.calculateExpectedReturn(tokenAddress, tokenAmount))
            .rejects
            .toThrow(errorMessage);
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error calculating expected return',
            errorMessage
        );
    });
}); 