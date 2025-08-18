import { config } from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { walletManager } from '../wallet';
import { logger } from '../utils/logger';
import fetch from 'node-fetch';

// Load environment variables
config();

async function debugEnvironment() {
    console.log('🔍 Debugging Environment Variables and Wallet...\n');

    // Check environment variables
    console.log('📋 Environment Variables:');
    console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
    console.log('PORT:', process.env.PORT || 'not set');
    console.log('SOLANA_RPC_URL:', process.env.SOLANA_RPC_URL ? 'set' : 'not set');
    console.log('HELIUS_API_KEY:', process.env.HELIUS_API_KEY ? 'set' : 'not set');
    console.log('WALLET_PRIVATE_KEY:', process.env.WALLET_PRIVATE_KEY ? 'set' : 'not set');
    console.log('TARGET_WALLET_ADDRESS:', process.env.TARGET_WALLET_ADDRESS ? 'set' : 'not set');
    console.log('FIXED_BUY_AMOUNT:', process.env.FIXED_BUY_AMOUNT || 'not set');
    console.log('MIN_SOL_BALANCE:', process.env.MIN_SOL_BALANCE || 'not set');
    console.log('MAX_SOL_PER_TRADE:', process.env.MAX_SOL_PER_TRADE || 'not set');
    console.log('PUMP_FUN_PROGRAM_ID:', process.env.PUMP_FUN_PROGRAM_ID || 'not set');

    console.log('\n🔧 Testing RPC Connection...');
    try {
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
        const slot = await connection.getSlot();
        console.log('✅ RPC Connection successful, current slot:', slot);
    } catch (error) {
        console.log('❌ RPC Connection failed:', error);
        return;
    }

    console.log('\n👛 Testing Wallet...');
    try {
        const publicKey = walletManager.getPublicKey();
        console.log('✅ Wallet public key:', publicKey.toString());
        
        const balance = await walletManager.getBalance();
        console.log('✅ Wallet balance:', balance, 'SOL');
        
        if (balance === 0) {
            console.log('⚠️  Warning: Wallet balance is 0 SOL');
        }
    } catch (error) {
        console.log('❌ Wallet test failed:', error);
    }

    console.log('\n📊 Testing Status Endpoint...');
    try {
        const response = await fetch('http://localhost:3000/status');
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Status endpoint working:', JSON.stringify(data, null, 2));
        } else {
            console.log('❌ Status endpoint failed:', response.status);
        }
    } catch (error) {
        console.log('❌ Status endpoint error:', error);
    }

    console.log('\n🎯 Recommendations:');
    
    if (!process.env.NODE_ENV) {
        console.log('- Add NODE_ENV=production');
    }
    
    if (!process.env.MIN_SOL_BALANCE) {
        console.log('- Add MIN_SOL_BALANCE=0.01');
    }
    
    if (!process.env.MAX_SOL_PER_TRADE) {
        console.log('- Add MAX_SOL_PER_TRADE=1.0');
    }
    
    if (!process.env.PUMP_FUN_PROGRAM_ID) {
        console.log('- Add PUMP_FUN_PROGRAM_ID=troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61');
    }
}

// Run debug if this file is executed directly
if (require.main === module) {
    debugEnvironment().catch(console.error);
}

export { debugEnvironment };
