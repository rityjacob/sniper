import { TRANSACTION_CONFIG } from './config';

interface TestCase {
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

const testCases: TestCase[] = [
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

console.log("🧪 Starting amount calculation tests...\n");
console.log("Configuration:");
console.log(`- Percentage of target trade: ${TRANSACTION_CONFIG.percentageOfTargetTrade * 100}%`);
console.log(`- Max buy amount: ${TRANSACTION_CONFIG.maxBuyAmount} SOL`);
console.log(`- Max SOL per trade: ${TRANSACTION_CONFIG.maxSolPerTrade} SOL\n`);

let passedTests = 0;
let failedTests = 0;

testCases.forEach((testCase, index) => {
    console.log(`\nTest Case ${index + 1}: ${testCase.description}`);
    console.log(`Target Amount: ${testCase.targetAmount} SOL`);
    
    const calculatedAmount = calculateBuyAmount(testCase.targetAmount);
    console.log(`Calculated Amount: ${calculatedAmount} SOL`);
    console.log(`Expected Amount: ${testCase.expectedAmount} SOL`);
    
    const passed = Math.abs(calculatedAmount - testCase.expectedAmount) < 0.0001;
    if (passed) {
        console.log("✅ Test Passed");
        passedTests++;
    } else {
        console.log("❌ Test Failed");
        failedTests++;
    }
});

console.log("\n📊 Test Summary:");
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log(`Success Rate: ${((passedTests / testCases.length) * 100).toFixed(2)}%`); 