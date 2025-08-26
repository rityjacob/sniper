import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Check webhook configuration and provide recommendations
 */
export function checkWebhookConfiguration() {
    console.log('\n🔧 === WEBHOOK CONFIGURATION CHECK ===');
    
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    const webhookUrl = process.env.RENDER_EXTERNAL_URL || 'https://your-app-name.onrender.com';
    
    console.log('🎯 Target Wallet:', targetWallet || 'NOT SET');
    console.log('🌐 Webhook URL:', webhookUrl);
    
    console.log('\n📋 RECOMMENDED HELIUS WEBHOOK CONFIGURATION:');
    console.log('1. Go to your Helius dashboard');
    console.log('2. Create a new webhook with these settings:');
    console.log('   - Network: mainnet');
    console.log('   - Webhook Type: enhanced');
    console.log('   - Transaction Type(s): ALL (or at least SWAP, TRANSFER)');
    console.log('   - Webhook URL:', `${webhookUrl}/webhook`);
    console.log('   - Account Addresses: Add your target wallet address');
    console.log('   - Include Failed Transactions: false');
    console.log('   - Include Vote Transactions: false');
    console.log('   - Include All Account Data: true');
    
    console.log('\n🔍 WHY YOU MIGHT NOT BE RECEIVING BUY TRANSACTIONS:');
    console.log('1. Webhook is filtering by transaction type');
    console.log('2. Target wallet is not making pure buy transactions');
    console.log('3. Target wallet is only doing complex swaps');
    console.log('4. Webhook is not configured for the target wallet address');
    
    console.log('\n💡 TROUBLESHOOTING STEPS:');
    console.log('1. Check Helius webhook logs for failed deliveries');
    console.log('2. Verify target wallet is actually making buy transactions');
    console.log('3. Test webhook with a simple transaction');
    console.log('4. Check if target wallet uses different addresses for buys');
    
    console.log('\n🧪 TEST YOUR WEBHOOK:');
    console.log('Run this command to test your webhook:');
    console.log(`curl -X POST ${webhookUrl}/test-webhook -H "Content-Type: application/json" -d '{"test": "data"}'`);
    
    console.log('\n📊 MONITORING:');
    console.log('1. Check your webhook server logs');
    console.log('2. Monitor Helius webhook delivery status');
    console.log('3. Use Solscan to track target wallet transactions');
    console.log('4. Set up alerts for webhook failures');
    
    console.log('\n=== END CONFIGURATION CHECK ===\n');
}

/**
 * Analyze target wallet transaction patterns
 */
export function analyzeTargetWalletPatterns() {
    console.log('\n📊 === TARGET WALLET ANALYSIS ===');
    
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    if (!targetWallet) {
        console.log('❌ TARGET_WALLET_ADDRESS not set');
        return;
    }
    
    console.log('🎯 Target Wallet:', targetWallet);
    console.log('\n🔍 HOW TO ANALYZE TARGET WALLET:');
    console.log('1. Visit Solscan: https://solscan.io/account/' + targetWallet);
    console.log('2. Look for recent transactions');
    console.log('3. Identify buy vs sell patterns');
    console.log('4. Check if buys are pure SOL->Token or complex swaps');
    
    console.log('\n📈 TYPICAL TRANSACTION PATTERNS:');
    console.log('- Pure Buy: SOL → Token (what you want to capture)');
    console.log('- Pure Sell: Token → SOL (what you want to skip)');
    console.log('- Complex Swap: Token A → Token B (might be filtered)');
    console.log('- Liquidity Operations: Add/Remove liquidity');
    
    console.log('\n🎯 WHAT TO LOOK FOR:');
    console.log('1. Transactions where target wallet receives tokens');
    console.log('2. Transactions where target wallet spends SOL');
    console.log('3. Pump.fun program interactions');
    console.log('4. Jupiter or other DEX interactions');
    
    console.log('\n=== END WALLET ANALYSIS ===\n');
}

if (require.main === module) {
    checkWebhookConfiguration();
    analyzeTargetWalletPatterns();
}
