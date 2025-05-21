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

// Mock dexManager before importing transaction
jest.mock('../dex', () => ({
    dexManager: {
        checkLiquidity: jest.fn(),
        calculatePriceImpact: jest.fn()
    }
}));

import { dexManager } from '../dex';
import fetch from 'node-fetch';
import { logger } from '../utils/logger';
import { transactionManager } from '../transaction';
import { SAFETY_CONFIG, TRANSACTION_CONFIG, DEX_CONFIG } from '../config';

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

describe('TransactionManager - processTransaction', () => {
    let transactionManager: typeof import('../transaction').transactionManager;
    const tx = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        amount: '10',
        signature: 'mock_signature',
        timestamp: Date.now()
    };

    beforeEach(() => {
        jest.clearAllMocks();
        transactionManager = require('../transaction').transactionManager;
        // Mock checkSafetyLimits to return true
        (transactionManager as any).checkSafetyLimits = jest.fn().mockReturnValue(true);
        // Mock Date.now() to return a value that ensures the trade cooldown is not active
        jest.spyOn(Date, 'now').mockReturnValue(SAFETY_CONFIG.tradeCooldown + 1);
        // Mock lastTradeTime to ensure the cooldown is not active
        (transactionManager as any).lastTradeTime = 0;
        // Mock updateTradeCounters to do nothing
        (transactionManager as any).updateTradeCounters = jest.fn();
    });

    it('should process transaction successfully', async () => {
        // Mock dexManager methods
        (dexManager.checkLiquidity as jest.Mock).mockResolvedValue(true);
        (dexManager.calculatePriceImpact as jest.Mock).mockResolvedValue(2);

        const result = await transactionManager.processTransaction(tx);
        expect(result).toBe(true);
        expect(logger.logInfo).toHaveBeenCalledWith(
            'system',
            'Transaction validation successful',
            `Token: ${tx.tokenAddress}, Amount: ${tx.amount} SOL`
        );
    });

    it('should reject blacklisted token', async () => {
        SAFETY_CONFIG.blacklistedTokens.push(tx.tokenAddress);
        const result = await transactionManager.processTransaction(tx);
        expect(result).toBe(false);
        expect(logger.logWarning).toHaveBeenCalledWith(
            'safety',
            'Token is blacklisted',
            tx.tokenAddress
        );
        SAFETY_CONFIG.blacklistedTokens.pop();
    });

    it('should reject insufficient liquidity', async () => {
        (dexManager.checkLiquidity as jest.Mock).mockResolvedValue(false);
        const result = await transactionManager.processTransaction(tx);
        expect(result).toBe(false);
        expect(logger.logWarning).toHaveBeenCalledWith(
            'dex',
            'Insufficient liquidity',
            tx.tokenAddress
        );
    });

    it('should reject high price impact', async () => {
        (dexManager.checkLiquidity as jest.Mock).mockResolvedValue(true);
        (dexManager.calculatePriceImpact as jest.Mock).mockResolvedValue(DEX_CONFIG.maxPriceImpact + 1);

        const result = await transactionManager.processTransaction(tx);
        expect(result).toBe(false);
        expect(logger.logWarning).toHaveBeenCalledWith(
            'dex',
            'Price impact too high',
            `Impact: ${DEX_CONFIG.maxPriceImpact + 1}%, Max: ${DEX_CONFIG.maxPriceImpact}%`
        );
    });

    it('should handle API error', async () => {
        const errorMessage = 'API error';
        (dexManager.checkLiquidity as jest.Mock).mockRejectedValue(new Error(errorMessage));

        const result = await transactionManager.processTransaction(tx);
        expect(result).toBe(false);
        expect(logger.logError).toHaveBeenCalledWith(
            'system',
            'Transaction validation failed',
            errorMessage
        );
    });
}); 