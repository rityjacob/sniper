import fetch from 'node-fetch';

const WEBHOOK_URL = 'http://localhost:3000/webhook/pump-fun';

// Sample webhook data for testing
const testWebhookData = {
    inputMint: 'So11111111111111111111111111111111111111112', // SOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (example)
    amount: '1000000000', // 1 SOL in lamports
    accounts: [
        '11111111111111111111111111111112',
        '22222222222222222222222222222222',
        '33333333333333333333333333333333'
    ],
    programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
    data: 'dGVzdC1kYXRh', // "test-data" in base64
    transaction: {
        signature: 'test-signature-123',
        slot: 123456,
        blockTime: 1234567890,
        meta: {
            err: null,
            fee: 5000,
            preBalances: [1000000000, 0],
            postBalances: [999995000, 1000000],
            preTokenBalances: [],
            postTokenBalances: [
                {
                    owner: '11111111111111111111111111111112',
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    uiTokenAmount: { amount: '1000000' }
                }
            ],
            logMessages: [
                'Program troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61 invoke',
                'Program troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61 success'
            ]
        },
        transaction: {
            message: {
                accountKeys: [
                    '11111111111111111111111111111112',
                    '22222222222222222222222222222222',
                    '33333333333333333333333333333333'
                ],
                instructions: [
                    {
                        programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
                        accounts: [0, 1, 2],
                        data: 'dGVzdC1kYXRh'
                    }
                ]
            }
        }
    }
};

async function testWebhook() {
    try {
        console.log('🧪 Testing webhook server...');
        console.log(`📡 Sending POST request to: ${WEBHOOK_URL}`);
        console.log('📦 Webhook data:', JSON.stringify(testWebhookData, null, 2));

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testWebhookData)
        });

        const responseData = await response.json();

        console.log(`📊 Response Status: ${response.status}`);
        console.log('📄 Response Data:', JSON.stringify(responseData, null, 2));

        if (response.ok) {
            console.log('✅ Webhook test successful!');
        } else {
            console.log('❌ Webhook test failed!');
        }

    } catch (error) {
        console.error('💥 Error testing webhook:', error);
    }
}

async function testHealthCheck() {
    try {
        console.log('\n🏥 Testing health check...');
        
        const response = await fetch('http://localhost:3000/health');
        const data = await response.json();

        console.log(`📊 Health Status: ${response.status}`);
        console.log('📄 Health Data:', JSON.stringify(data, null, 2));

        if (response.ok) {
            console.log('✅ Health check successful!');
        } else {
            console.log('❌ Health check failed!');
        }

    } catch (error) {
        console.error('💥 Error testing health check:', error);
    }
}

async function testStatus() {
    try {
        console.log('\n📊 Testing status endpoint...');
        
        const response = await fetch('http://localhost:3000/status');
        const data = await response.json();

        console.log(`📊 Status Response: ${response.status}`);
        console.log('📄 Status Data:', JSON.stringify(data, null, 2));

        if (response.ok) {
            console.log('✅ Status check successful!');
        } else {
            console.log('❌ Status check failed!');
        }

    } catch (error) {
        console.error('💥 Error testing status:', error);
    }
}

async function runTests() {
    console.log('🚀 Starting webhook server tests...\n');
    
    await testHealthCheck();
    await testStatus();
    await testWebhook();
    
    console.log('\n✨ All tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().catch(console.error);
}

export { testWebhook, testHealthCheck, testStatus, runTests };
