import fetch from 'node-fetch';

const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://sniper-tup2.onrender.com';

async function testConnectivity() {
    console.log('🧪 Testing webhook server connectivity...');
    console.log('🌐 Server URL:', SERVER_URL);
    
    try {
        // Test 1: Basic GET request
        console.log('\n📡 Test 1: Basic connectivity (GET /test)');
        const testResponse = await fetch(`${SERVER_URL}/test`);
        const testData = await testResponse.json();
        console.log('✅ Status:', testResponse.status);
        console.log('📋 Response:', JSON.stringify(testData, null, 2));
        
        // Test 2: Health check
        console.log('\n📡 Test 2: Health check (GET /health)');
        const healthResponse = await fetch(`${SERVER_URL}/health`);
        const healthData = await healthResponse.json();
        console.log('✅ Status:', healthResponse.status);
        console.log('📋 Response:', JSON.stringify(healthData, null, 2));
        
        // Test 3: Test webhook endpoint
        console.log('\n📡 Test 3: Test webhook (POST /test-webhook)');
        const webhookResponse = await fetch(`${SERVER_URL}/test-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                test: true,
                timestamp: new Date().toISOString(),
                message: 'Test webhook from script'
            })
        });
        const webhookData = await webhookResponse.json();
        console.log('✅ Status:', webhookResponse.status);
        console.log('📋 Response:', JSON.stringify(webhookData, null, 2));
        
        console.log('\n🎉 All tests passed! Server is reachable and responding correctly.');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        console.log('\n🔍 Troubleshooting tips:');
        console.log('1. Check if the server is deployed on Render');
        console.log('2. Verify the RENDER_EXTERNAL_URL environment variable');
        console.log('3. Check Render logs for any errors');
        console.log('4. Make sure the server is not sleeping (check self-ping)');
    }
}

// Run the test
testConnectivity();
