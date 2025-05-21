import { TRANSACTION_CONFIG, DEX_CONFIG, SAFETY_CONFIG } from '../config';
import { transactionManager } from '../transaction';
import * as dexModule from '../dex';

// Mock wallet functionality
jest.mock('../wallet', () => ({
    walletManager: {
        checkMinimumBalance: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockReturnValue('mock-public-key'),
        signAndSendTransaction: jest.fn().mockResolvedValue('mock-signature')
    }
}));

// Mock DexManager
jest.mock('../dex', () => ({
    dexManager: {
        checkLiquidity: jest.fn(),
        calculatePriceImpact: jest.fn(),
        executeSwap: jest.fn().mockResolvedValue('mock-signature')
    }
}));

interface TestCase {
    description: string;
    transaction: {
        signature: string;
        timestamp: number;
        tokenAddress: string;
        amount: string;
    };
    mockLiquidity?: number;
    mockPriceImpact?: number;
    isBlacklisted?: boolean;
    expectedResult: boolean;
}

// Create test cases
const testCases: TestCase[] = [
    {
        description: "Valid transaction with sufficient liquidity",
        transaction: {
            signature: "test1",
            timestamp: Date.now(),
            tokenAddress: "valid_token",
            amount: "10"
        },
        mockLiquidity: 2000,
        mockPriceImpact: 2,
        expectedResult: true
    },
    {
        description: "Transaction with insufficient liquidity",
        transaction: {
            signature: "test2",
            timestamp: Date.now(),
            tokenAddress: "low_liquidity_token",
            amount: "10"
        },
        mockLiquidity: 500,
        mockPriceImpact: 2,
        expectedResult: false
    },
    {
        description: "Transaction with high price impact",
        transaction: {
            signature: "test3",
            timestamp: Date.now(),
            tokenAddress: "high_impact_token",
            amount: "10"
        },
        mockLiquidity: 2000,
        mockPriceImpact: 6,
        expectedResult: false
    },
    {
        description: "Blacklisted token transaction",
        transaction: {
            signature: "test4",
            timestamp: Date.now(),
            tokenAddress: "blacklisted_token",
            amount: "10"
        },
        mockLiquidity: 2000,
        mockPriceImpact: 2,
        isBlacklisted: true,
        expectedResult: false
    }
];

describe('Transaction Validation', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    for (const [index, testCase] of testCases.entries()) {
        test(testCase.description, async () => {
            // Set up mocks for this test case
            (dexModule.dexManager.checkLiquidity as jest.Mock).mockResolvedValue(
                (testCase.mockLiquidity || 0) > DEX_CONFIG.minLiquidity
            );
            (dexModule.dexManager.calculatePriceImpact as jest.Mock).mockResolvedValue(
                testCase.mockPriceImpact || 0
            );
            
            if (testCase.isBlacklisted) {
                SAFETY_CONFIG.blacklistedTokens.push(testCase.transaction.tokenAddress);
            }

            const result = await transactionManager.processTransaction(testCase.transaction);
            
            if (testCase.isBlacklisted) {
                SAFETY_CONFIG.blacklistedTokens = SAFETY_CONFIG.blacklistedTokens.filter(
                    token => token !== testCase.transaction.tokenAddress
                );
            }

            expect(result).toBe(testCase.expectedResult);
        });
    }
}); 