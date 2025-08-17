import { dexManager } from '../dex';
import { PumpFunWebhook } from '../types';
import { logger } from '../utils/logger';

/**
 * Example of how to use the Pump.fun DEX implementation
 */
async function pumpFunExample() {
    try {
        logger.logInfo('example', 'Starting Pump.fun example', 'Processing webhook data');

        // Example webhook data from Pump.fun
        const webhookData: PumpFunWebhook = {
            inputMint: 'So11111111111111111111111111111111111111112', // SOL
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (example)
            amount: '1000000000', // 1 SOL in lamports
            accounts: [
                'YourWalletAddressHere', // Replace with actual wallet address
                'TokenAccountAddress1',
                'TokenAccountAddress2',
                // ... other required accounts
            ],
            programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
            data: 'TBXxRE...' // Replace with actual base64 instruction data
        };

        // Process the webhook and execute swap
        const signature = await dexManager.processWebhookAndSwap(webhookData, 0.1); // 0.1 SOL
        
        logger.logInfo('example', 'Swap completed successfully', `Signature: ${signature}`);
        
        // Example of getting token price
        const price = await dexManager.getTokenPrice(webhookData.outputMint);
        logger.logInfo('example', 'Token price', `Price: ${price} SOL`);
        
        // Example of checking liquidity
        const hasLiquidity = await dexManager.checkLiquidity(webhookData.outputMint);
        logger.logInfo('example', 'Liquidity check', `Has liquidity: ${hasLiquidity}`);
        
        // Example of getting token balance
        const balance = await dexManager.getTokenBalance(webhookData.outputMint);
        logger.logInfo('example', 'Token balance', `Balance: ${balance} tokens`);

    } catch (error: any) {
        logger.logError('example', 'Pump.fun example failed', error.message);
        console.error('Example failed:', error);
    }
}

/**
 * Example of how to decode and analyze instruction data
 */
function analyzeInstructionExample() {
    try {
        // Example base64 instruction data
        const base64Data = 'TBXxRE...'; // Replace with actual data
        
        // This would be done internally by the DEX manager
        const raw = Buffer.from(base64Data, 'base64');
        console.log('Raw instruction data (hex):', raw.toString('hex'));
        
        // Analyze structure
        if (raw.length >= 9) {
            const functionId = raw[0];
            const amountBytes = raw.slice(1, 9);
            const amount = amountBytes.readBigUInt64LE(0);
            const remainingData = raw.slice(9);
            
            console.log('Function ID:', functionId);
            console.log('Amount (lamports):', amount.toString());
            console.log('Amount (SOL):', Number(amount) / 1e9);
            console.log('Remaining data length:', remainingData.length);
        }
        
    } catch (error: any) {
        console.error('Analysis failed:', error.message);
    }
}

// Run examples if this file is executed directly
if (require.main === module) {
    console.log('Running Pump.fun examples...');
    analyzeInstructionExample();
    // pumpFunExample(); // Uncomment to run the full example
}

export { pumpFunExample, analyzeInstructionExample };
