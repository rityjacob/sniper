import { Connection, PublicKey } from '@solana/web3.js';
import { RPC_URL, DEX_CONFIG } from '../config';
import fetch from 'node-fetch';

async function findTokens() {
    console.log('🔍 Fetching tokens from Jupiter devnet list...');
    
    try {
        // Get token list from Jupiter
        const response = await fetch(`${DEX_CONFIG.jupiterApiUrl}/tokens`);
        const tokens = await response.json();
        
        console.log(`Found ${tokens.length} tokens`);

        // Print the first 5 token mint addresses
        console.log('\n📊 First 5 token mint addresses:');
        tokens.slice(0, 5).forEach((mint: string, idx: number) => {
            console.log(`#${idx + 1}: ${mint}`);
        });

    } catch (error) {
        console.error('Error finding tokens:', error);
    }
}

findTokens().catch(console.error); 