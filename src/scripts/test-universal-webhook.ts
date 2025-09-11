import fetch from 'node-fetch';
import { config } from 'dotenv';

// Load environment variables
config();

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';

// Test webhook data simulating a buy transaction
const testBuyWebhook = {
    type: 'SWAP',
    signature: 'test_signature_123456789',
    slot: 123456789,
    timestamp: Date.now() / 1000,
    feePayer: 'target_wallet_address',
    tokenTransfers: [
        {
            mint: 'test_token_mint_123456789',
            fromUserAccount: 'some_other_wallet',
            toUserAccount: process.env.TARGET_WALLET_ADDRESS || 'target_wallet_address',
            tokenAmount: '1000000',
            fromTokenAccount: 'some_token_account',
            toTokenAccount: 'target_token_account'
        }
    ],
    nativeTransfers: [
        {
            fromUserAccount: process.env.TARGET_WALLET_ADDRESS || 'target_wallet_address',
            toUserAccount: 'some_other_wallet',
            amount: '100000000', // 0.1 SOL in lamports
        }
    ],
    instructions: [
        {
            programId: 'some_program_id',
            data: 'test_data'
        }
    ],
    accountData: [
        {
            account: 'account1'
        }
    ]
};

// Test webhook data simulating a sell transaction (should be skipped)
const testSellWebhook = {
    type: 'SWAP',
    signature: 'test_signature_987654321',
    slot: 987654321,
    timestamp: Date.now() / 1000,
    feePayer: 'target_wallet_address',
    tokenTransfers: [
        {
            mint: 'test_token_mint_987654321',
            fromUserAccount: process.env.TARGET_WALLET_ADDRESS || 'target_wallet_address',
            toUserAccount: 'some_other_wallet',
            tokenAmount: '1000000',
            fromTokenAccount: 'target_token_account',
            toTokenAccount: 'some_token_account'
        }
    ],
    nativeTransfers: [
        {
            fromUserAccount: 'some_other_wallet',
            toUserAccount: process.env.TARGET_WALLET_ADDRESS || 'target_wallet_address',
            amount: '100000000', // 0.1 SOL in lamports
        }
    ],
    instructions: [
        {
            programId: 'some_program_id',
            data: 'test_data'
        }
    ],
    accountData: [
        {
            account: 'account1'
        }
    ]
};

async function testWebhook(webhookData: any, description: string) {
    try {
        console.log(`\n🧪 Testing: ${description}`);
        console.log(`📡 Sending to: ${WEBHOOK_URL}`);
        
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(webhookData)
        });

        const result = await response.json();
        
        console.log(`📊 Response Status: ${response.status}`);
        console.log(`📋 Response:`, JSON.stringify(result, null, 2));
        
        if (response.ok) {
            console.log(`✅ Test passed: ${description}`);
        } else {
            console.log(`❌ Test failed: ${description}`);
        }
        
        return result;
    } catch (error) {
        console.log(`❌ Error testing webhook: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

async function main() {
    console.log('🚀 Starting Universal Webhook Tests');
    console.log(`🎯 Target Wallet: ${process.env.TARGET_WALLET_ADDRESS || 'NOT SET'}`);
    console.log(`💰 Fixed Buy Amount: ${process.env.FIXED_BUY_AMOUNT || 'NOT SET'}`);
    
    // Test 1: Buy transaction (should trigger bot)
    await testWebhook(testBuyWebhook, 'Buy Transaction (should trigger bot)');
    
    // Test 2: Sell transaction (should be skipped)
    await testWebhook(testSellWebhook, 'Sell Transaction (should be skipped)');
    
    // Test 3: Non-buy transaction (should be skipped)
    const nonBuyWebhook = {
        type: 'TRANSFER',
        signature: 'test_signature_555555555',
        slot: 555555555,
        timestamp: Date.now() / 1000,
        feePayer: 'some_wallet',
        tokenTransfers: [],
        nativeTransfers: [
            {
                fromUserAccount: 'wallet1',
                toUserAccount: 'wallet2',
                amount: '50000000',
            }
        ],
        instructions: [],
        accountData: []
    };
    
    await testWebhook(nonBuyWebhook, 'Non-buy Transaction (should be skipped)');
    
    console.log('\n🎉 Universal Webhook Tests Completed!');
}

main().catch(console.error);
