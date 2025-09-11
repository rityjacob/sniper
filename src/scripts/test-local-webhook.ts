import fetch from 'node-fetch';

const LOCAL_URL = 'http://localhost:3000';

async function testLocalWebhook() {
    console.log('🧪 Testing local webhook server...');
    console.log('🌐 Local URL:', LOCAL_URL);
    
    try {
        // Test 1: Basic connectivity
        console.log('\n📡 Test 1: Basic connectivity (GET /test)');
        const testResponse = await fetch(`${LOCAL_URL}/test`);
        const testData = await testResponse.json();
        console.log('✅ Status:', testResponse.status);
        console.log('📋 Response:', JSON.stringify(testData, null, 2));
        
        // Test 2: Test webhook with sample data
        console.log('\n📡 Test 2: Sample webhook data (POST /webhook)');
        const sampleWebhookData = {
            type: 'SWAP',
            signature: 'test-signature-123',
            tokenTransfers: [
                {
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                    fromUserAccount: 'some-other-wallet',
                    toUserAccount: process.env.TARGET_WALLET_ADDRESS || 'your-target-wallet',
                    tokenAmount: '1000000', // 1 USDC
                    fromTokenAccount: 'some-token-account',
                    toTokenAccount: 'target-token-account'
                }
            ],
            nativeTransfers: [
                {
                    fromUserAccount: process.env.TARGET_WALLET_ADDRESS || 'your-target-wallet',
                    toUserAccount: 'some-destination',
                    amount: '100000000', // 0.1 SOL in lamports
                }
            ],
            programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
            timestamp: new Date().toISOString()
        };
        
        const webhookResponse = await fetch(`${LOCAL_URL}/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sampleWebhookData)
        });
        const webhookData = await webhookResponse.json();
        console.log('✅ Status:', webhookResponse.status);
        console.log('📋 Response:', JSON.stringify(webhookData, null, 2));
        
        console.log('\n🎉 Local tests completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        console.log('\n🔍 Make sure your local server is running:');
        console.log('1. Run: npm run dev');
        console.log('2. Check if server starts on port 3000');
        console.log('3. Verify TARGET_WALLET_ADDRESS is set in your .env file');
    }
}

// Run the test
testLocalWebhook();
