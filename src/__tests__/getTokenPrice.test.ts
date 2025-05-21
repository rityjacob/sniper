// Mock node-fetch at the very top
jest.mock('node-fetch', () => jest.fn());

// Mock wallet before importing dex
jest.mock('../wallet', () => ({
    walletManager: {
        getPublicKey: () => ({
            toString: () => 'So11111111111111111111111111111111111111112'
        }),
        signAndSendTransaction: jest.fn()
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

describe('DexManager - getTokenPrice', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fetch token price successfully', async () => {
        const expectedPrice = 1.5;
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ price: expectedPrice })
        });

        const price = await dexManager.getTokenPrice(tokenAddress);
        expect(price).toBe(expectedPrice);
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Token price fetched',
            `Token: ${tokenAddress}, Price: ${expectedPrice} SOL`
        );
    });

    it('should handle missing price in response', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({})
        });

        const price = await dexManager.getTokenPrice(tokenAddress);
        expect(price).toBe(0);
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Token price fetched',
            `Token: ${tokenAddress}, Price: 0 SOL`
        );
    });

    it('should handle API error', async () => {
        const errorMessage = 'API error';
        mockFetch.mockRejectedValueOnce(new Error(errorMessage));

        await expect(dexManager.getTokenPrice(tokenAddress))
            .rejects
            .toThrow(errorMessage);
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Failed to get token price',
            errorMessage
        );
    });
}); 