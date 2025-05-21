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

describe('DexManager - sellPercentageOfHoldings', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const percentage = 50;
    const balance = 2000;
    const amountToSell = Math.floor(balance * (percentage / 100));
    const mockQuote = {
        outAmount: '1000000000',
        inAmount: '1000000000'
    };
    const mockPrice = 1.0;
    const mockLiquidity = 10000;
    const mockSwapTransaction = {
        swapTransaction: 'mock_transaction'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should sell percentage of holdings successfully', async () => {
        // getTokenBalance
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ balance })
            })
            // quote
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuote)
            })
            // price
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ price: mockPrice })
            })
            // liquidity
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ liquidity: mockLiquidity })
            })
            // sellToken: balance check
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ balance: amountToSell })
            })
            // sellToken: quote
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuote)
            })
            // sellToken: swap
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockSwapTransaction)
            });

        const signature = await dexManager.sellPercentageOfHoldings(tokenAddress, percentage);
        expect(signature).toBe('mock_signature');
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Selling percentage of holdings',
            `Token: ${tokenAddress}, Percentage: ${percentage}%, Amount: ${amountToSell}, Expected SOL: 1`
        );
    });

    it('should handle invalid percentage', async () => {
        await expect(dexManager.sellPercentageOfHoldings(tokenAddress, 0))
            .rejects
            .toThrow('Percentage must be between 0 and 100');
        await expect(dexManager.sellPercentageOfHoldings(tokenAddress, 150))
            .rejects
            .toThrow('Percentage must be between 0 and 100');
    });

    it('should handle no tokens available to sell', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ balance: 0 })
        });
        await expect(dexManager.sellPercentageOfHoldings(tokenAddress, 50))
            .rejects
            .toThrow('No tokens available to sell');
    });

    it('should handle API error', async () => {
        const errorMessage = 'API error';
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ balance })
            })
            .mockRejectedValueOnce(new Error(errorMessage));
        await expect(dexManager.sellPercentageOfHoldings(tokenAddress, 50))
            .rejects
            .toThrow(errorMessage);
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error selling percentage of holdings',
            errorMessage
        );
    });
}); 