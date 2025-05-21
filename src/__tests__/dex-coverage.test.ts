import { dexManager } from '../dex';
import { DEX_CONFIG } from '../config';
import { logger } from '../utils/logger';

// Mock node-fetch
jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
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

// Mock bs58
jest.mock('bs58', () => ({
    decode: jest.fn(() => new Uint8Array(64))
}));

describe('DexManager - checkLiquidity', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    it('should return true and not log warning if liquidity is above minimum', async () => {
        // Mock getTokenLiquidity to return high liquidity
        jest.spyOn(dexManager as any, 'getTokenLiquidity').mockResolvedValue(DEX_CONFIG.minLiquidity + 1);
        const result = await dexManager.checkLiquidity(tokenAddress);
        expect(result).toBe(true);
        expect(logger.logWarning).not.toHaveBeenCalled();
    });

    it('should return false and log warning if liquidity is below minimum', async () => {
        jest.spyOn(dexManager as any, 'getTokenLiquidity').mockResolvedValue(DEX_CONFIG.minLiquidity - 1);
        const result = await dexManager.checkLiquidity(tokenAddress);
        expect(result).toBe(false);
        expect(logger.logWarning).toHaveBeenCalledWith(
            'dex',
            'Insufficient liquidity',
            expect.stringContaining('Liquidity:')
        );
    });

    it('should return false and log error if getTokenLiquidity throws', async () => {
        jest.spyOn(dexManager as any, 'getTokenLiquidity').mockRejectedValue(new Error('liquidity error'));
        const result = await dexManager.checkLiquidity(tokenAddress);
        expect(result).toBe(false);
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error checking liquidity',
            'liquidity error'
        );
    });
});

describe('DexManager - getTokenLiquidity', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });
    it('should log error and return 0 if API call fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('api fail'));
        const result = await (dexManager as any).getTokenLiquidity(tokenAddress);
        expect(result).toBe(0);
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error fetching token liquidity',
            'api fail'
        );
    });
});

describe('DexManager - calculatePriceImpact', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });
    it('should log error and rethrow if getTokenPrice throws', async () => {
        jest.spyOn(dexManager, 'getTokenPrice').mockRejectedValue(new Error('price error'));
        await expect(dexManager.calculatePriceImpact(tokenAddress, 100)).rejects.toThrow('price error');
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error calculating price impact',
            'price error'
        );
    });
    it('should log error and rethrow if getTokenLiquidity throws', async () => {
        jest.spyOn(dexManager, 'getTokenPrice').mockResolvedValue(1);
        jest.spyOn(dexManager as any, 'getTokenLiquidity').mockRejectedValue(new Error('liquidity error'));
        await expect(dexManager.calculatePriceImpact(tokenAddress, 100)).rejects.toThrow('liquidity error');
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error calculating price impact',
            'liquidity error'
        );
    });
});

describe('DexManager - calculateExpectedReturn', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });
    it('should log error and rethrow if quote API call fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('quote error'));
        await expect(dexManager.calculateExpectedReturn(tokenAddress, 100)).rejects.toThrow('quote error');
        expect(logger.logError).toHaveBeenCalledWith(
            'dex',
            'Error calculating expected return',
            'quote error'
        );
    });
}); 