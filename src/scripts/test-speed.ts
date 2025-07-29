import { Connection, PublicKey } from '@solana/web3.js';
import { RPC_URL, DEX_CONFIG, TRANSACTION_CONFIG, SAFETY_CONFIG } from '../config';
import { walletManager } from '../wallet';
import fetch from 'node-fetch';

async function testSpeed() {
    console.log('⚡ Testing Fast Sniper Speed Optimizations...\n');

    const connection = new Connection(RPC_URL, 'processed');
    
    // Test 1: WebSocket connection speed
    console.log('1. Testing WebSocket connection...');
    const wsStart = Date.now();
    const WebSocket = require('ws');
    const ws = new WebSocket(process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com');
    
    ws.on('open', () => {
        const wsTime = Date.now() - wsStart;
        console.log(`   ✅ WebSocket connected in ${wsTime}ms`);
        ws.close();
    });

    // Test 2: API call speed
    console.log('\n2. Testing API call speed...');
    const apiStart = Date.now();
    try {
        const response = await fetch(`${DEX_CONFIG.jupiterApiUrl}/tokens`);
        const apiTime = Date.now() - apiStart;
        console.log(`   ✅ API call completed in ${apiTime}ms`);
    } catch (error) {
        console.log(`   ❌ API call failed: ${error}`);
    }

    // Test 3: Transaction preparation speed
    console.log('\n3. Testing transaction preparation...');
    const txStart = Date.now();
    try {
        // Simulate a quick quote request
        const quoteUrl = `${DEX_CONFIG.jupiterApiUrl}/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&onlyDirectRoutes=true&asLegacyTransaction=true`;
        const quoteResponse = await fetch(quoteUrl);
        const quote = await quoteResponse.json();
        const txTime = Date.now() - txStart;
        console.log(`   ✅ Transaction quote prepared in ${txTime}ms`);
    } catch (error) {
        console.log(`   ❌ Transaction preparation failed: ${error}`);
    }

    // Test 4: Wallet balance check speed
    console.log('\n4. Testing wallet operations...');
    const walletStart = Date.now();
    try {
        const balance = await walletManager.getBalance();
        const walletTime = Date.now() - walletStart;
        console.log(`   ✅ Wallet balance check in ${walletTime}ms (Balance: ${balance} SOL)`);
    } catch (error) {
        console.log(`   ❌ Wallet operation failed: ${error}`);
    }

    // Test 5: Configuration check
    console.log('\n5. Checking optimized configuration...');
    console.log(`   ✅ Priority Fee: ${TRANSACTION_CONFIG.priorityFee} lamports`);
    console.log(`   ✅ Compute Unit Price: ${TRANSACTION_CONFIG.computeUnitPrice} micro-lamports`);
    console.log(`   ✅ Max Retries: ${TRANSACTION_CONFIG.maxRetries}`);
    console.log(`   ✅ Timeout: ${TRANSACTION_CONFIG.timeout}ms`);
    console.log(`   ✅ Trade Cooldown: ${SAFETY_CONFIG.tradeCooldown}ms`);

    // Summary
    console.log('\n📊 Speed Optimization Summary:');
    console.log('   • WebSocket: Uses "processed" commitment (~400ms faster)');
    console.log('   • API Calls: 10ms intervals (vs 100ms)');
    console.log('   • Priority Fees: 5M lamports (vs 1M)');
    console.log('   • Safety Checks: Reduced for speed');
    console.log('   • Transaction Settings: Optimized for speed');
    
    console.log('\n🚀 Ready for fast trading! Use: npm run fast-sniper');
}

testSpeed().catch(console.error); 