// Simple test script to verify webhook server
const fetch = require('node-fetch');

const testWebhook = async () => {
    const webhookUrl = 'http://localhost:3000/webhook';
    
    // Mock Helius webhook payload
    const mockPayload = {
        signature: 'test_signature_123',
        slot: 12345,
        timestamp: Date.now(),
        instructions: [],
        accountData: [],
        tokenTransfers: [
            {
                fromUserAccount: 'test_from_wallet',
                toUserAccount: process.env.TARGET_WALLET_ADDRESS || 'test_target_wallet',
                fromTokenAccount: 'test_from_token_account',
                toTokenAccount: 'test_to_token_account',
                mint: 'test_token_mint_123',
                tokenAmount: '1000000'
            }
        ],
        nativeTransfers: [
            {
                fromUserAccount: process.env.TARGET_WALLET_ADDRESS || 'test_target_wallet',
                toUserAccount: 'test_to_wallet',
                amount: 1000000000 // 1 SOL in lamports
            }
        ]
    };
    
    try {
        console.log('🧪 Sending test webhook...');
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mockPayload)
        });
        
        const result = await response.json();
        console.log('✅ Webhook response:', result);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
};

// Run test if this file is executed directly
if (require.main === module) {
    testWebhook();
}

module.exports = testWebhook;
