import { TRANSACTION_CONFIG } from '../config';

interface AmountTestCase {
    targetAmount: number;
    expectedAmount: number;
    description: string;
}

function calculateBuyAmount(targetAmount: number): number {
    const percentageAmount = targetAmount * TRANSACTION_CONFIG.percentageOfTargetTrade;
    return Math.min(
        percentageAmount,
        TRANSACTION_CONFIG.maxBuyAmount,
        TRANSACTION_CONFIG.maxSolPerTrade
    );
}

describe('Amount Calculations', () => {
    const testCases: AmountTestCase[] = [
        {
            targetAmount: 10,
            expectedAmount: 0.5,
            description: "Small trade (10 SOL) - should buy 5%"
        },
        {
            targetAmount: 100,
            expectedAmount: 5,
            description: "Medium trade (100 SOL) - should buy 5%"
        },
        {
            targetAmount: 500,
            expectedAmount: 6,
            description: "Large trade (500 SOL) - should be limited by maxSolPerTrade (6 SOL)"
        },
        {
            targetAmount: 1,
            expectedAmount: 0.05,
            description: "Very small trade (1 SOL) - should buy 5%"
        },
        {
            targetAmount: 200,
            expectedAmount: 6,
            description: "Medium-large trade (200 SOL) - should be limited by maxSolPerTrade (6 SOL)"
        }
    ];

    testCases.forEach((testCase) => {
        test(testCase.description, () => {
            const calculatedAmount = calculateBuyAmount(testCase.targetAmount);
            expect(calculatedAmount).toBeCloseTo(testCase.expectedAmount, 2);
        });
    });

    test('Configuration values are properly set', () => {
        expect(TRANSACTION_CONFIG.percentageOfTargetTrade).toBe(0.05); // 5%
        expect(TRANSACTION_CONFIG.maxBuyAmount).toBe(20);
        expect(TRANSACTION_CONFIG.maxSolPerTrade).toBe(6);
    });

    test('Amount calculation respects all limits', () => {
        // Test with a very large amount to ensure all limits are respected
        const largeAmount = 1000;
        const calculatedAmount = calculateBuyAmount(largeAmount);
        
        // Should be limited by maxSolPerTrade (6 SOL)
        expect(calculatedAmount).toBe(TRANSACTION_CONFIG.maxSolPerTrade);
        
        // Verify it's not exceeding any limits
        expect(calculatedAmount).toBeLessThanOrEqual(TRANSACTION_CONFIG.maxBuyAmount);
        expect(calculatedAmount).toBeLessThanOrEqual(TRANSACTION_CONFIG.maxSolPerTrade);
        expect(calculatedAmount).toBeLessThanOrEqual(largeAmount * TRANSACTION_CONFIG.percentageOfTargetTrade);
    });
}); 