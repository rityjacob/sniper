// Add type declarations for fetch
declare global {
    interface Global {
        fetch: jest.Mock;
    }
}

// Mock node-fetch at the very top
jest.mock('node-fetch', () => jest.fn());

import { dexManager } from '../dex';
import { DEX_CONFIG } from '../config';
import { walletManager } from '../wallet';
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

// Mock wallet
jest.mock('../wallet', () => ({
    walletManager: {
        getPublicKey: () => ({
            toString: () => 'So11111111111111111111111111111111111111112'
        })
    }
}));

describe('DexManager - getTokenBalance', () => {
    const mockTokenAddress = 'So11111111111111111111111111111111111111112';
    const mockWalletAddress = 'So11111111111111111111111111111111111111112';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return balance when API call is successful', async () => {
        // Mock successful API response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ balance: 1000 })
        });

        const balance = await dexManager.getTokenBalance(mockTokenAddress);

        // Verify the result
        expect(balance).toBe(1000);

        // Verify the API call
        expect(mockFetch).toHaveBeenCalledWith(
            `${DEX_CONFIG.jupiterApiUrl}/balance?token=${mockTokenAddress}&wallet=${mockWalletAddress}`,
            undefined
        );
    });

    it('should return 0 when API call fails', async () => {
        // Mock failed API response
        mockFetch.mockRejectedValueOnce(new Error('API Error'));

        const balance = await dexManager.getTokenBalance(mockTokenAddress);

        // Verify the result
        expect(balance).toBe(0);
    });

    it('should return 0 when API returns no balance', async () => {
        // Mock API response with no balance
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({})
        });

        const balance = await dexManager.getTokenBalance(mockTokenAddress);

        // Verify the result
        expect(balance).toBe(0);
    });

    it('should handle rate limiting', async () => {
        // Mock successful API response
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ balance: 1000 })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ balance: 1000 })
            });

        // Call the function twice in quick succession
        const balance1 = await dexManager.getTokenBalance(mockTokenAddress);
        const balance2 = await dexManager.getTokenBalance(mockTokenAddress);

        // Verify both calls return the correct balance
        expect(balance1).toBe(1000);
        expect(balance2).toBe(1000);

        // Verify the API was called twice
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return correct balance for 50 SOL', async () => {
        // Mock successful API response with 50 SOL balance
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ balance: 50 })
        });

        const balance = await dexManager.getTokenBalance(mockTokenAddress);

        // Verify the result
        expect(balance).toBe(50);

        // Verify the API call
        expect(mockFetch).toHaveBeenCalledWith(
            `${DEX_CONFIG.jupiterApiUrl}/balance?token=${mockTokenAddress}&wallet=${mockWalletAddress}`,
            undefined
        );

        // Verify logging
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Token balance fetched',
            expect.stringContaining('Balance: 50')
        );
    });
}); 