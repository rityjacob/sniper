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

describe('DexManager - executeSwap', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const amount = 1;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should execute swap successfully', async () => {
        const mockQuote = {
            outAmount: '1000000000',
            inAmount: '1000000000'
        };
        const mockSwapTransaction = {
            swapTransaction: 'mock_transaction'
        };

        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuote)
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockSwapTransaction)
            });

        const signature = await dexManager.executeSwap(tokenAddress, amount);
        expect(signature).toBe('mock_signature');
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Executing swap',
            `Token: ${tokenAddress}, Amount: ${amount} SOL`
        );
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Quote received',
            JSON.stringify(mockQuote, null, 2)
        );
        expect(logger.logInfo).toHaveBeenCalledWith(
            'dex',
            'Swap transaction prepared',
            'Executing transaction'
        );
        expect(logger.logTransactionSuccess).toHaveBeenCalledWith(
            'mock_signature',
            tokenAddress,
            amount.toString()
        );
    });

    it('should handle invalid quote', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({})
        });

        await expect(dexManager.executeSwap(tokenAddress, amount))
            .rejects
            .toThrow('Invalid quote received from Jupiter');
        expect(logger.logTransactionFailure).toHaveBeenCalledWith(
            'pending',
            tokenAddress,
            amount.toString(),
            'Invalid quote received from Jupiter'
        );
    });

    it('should handle invalid swap transaction', async () => {
        const mockQuote = {
            outAmount: '1000000000',
            inAmount: '1000000000'
        };
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuote)
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({})
            });

        await expect(dexManager.executeSwap(tokenAddress, amount))
            .rejects
            .toThrow('Invalid swap transaction received from Jupiter');
        expect(logger.logTransactionFailure).toHaveBeenCalledWith(
            'pending',
            tokenAddress,
            amount.toString(),
            'Invalid swap transaction received from Jupiter'
        );
    });

    it('should handle API error', async () => {
        const errorMessage = 'API error';
        mockFetch.mockRejectedValueOnce(new Error(errorMessage));

        await expect(dexManager.executeSwap(tokenAddress, amount))
            .rejects
            .toThrow(errorMessage);
        expect(logger.logTransactionFailure).toHaveBeenCalledWith(
            'pending',
            tokenAddress,
            amount.toString(),
            errorMessage
        );
    });
}); 