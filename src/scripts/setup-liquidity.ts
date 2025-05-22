import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { RPC_URL } from '../config';
import * as fs from 'fs';
import 'dotenv/config';
import fetch from 'node-fetch';
import {
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

async function setupLiquidity() {
    try {
        console.log('🚀 Setting up liquidity pool...');
        
        // Load wallet and token info
        const targetWalletPath = 'target-wallet.json';
        const targetWalletData = JSON.parse(fs.readFileSync(targetWalletPath, 'utf-8'));
        const wallet = Keypair.fromSecretKey(new Uint8Array(targetWalletData));
        
        const tokenInfo = JSON.parse(fs.readFileSync('test-token.json', 'utf-8'));
        const tokenMint = new PublicKey(tokenInfo.mint);
        
        console.log('👛 Using wallet:', wallet.publicKey.toString());
        console.log('🪙 Token mint:', tokenMint.toString());
        
        // Connect to devnet
        const connection = new Connection(RPC_URL, 'confirmed');
        
        // Check wallet balance
        const balance = await connection.getBalance(wallet.publicKey);
        console.log(`\n💰 Wallet Balance: ${balance / 1e9} SOL`);
        
        // Amount of SOL to provide as liquidity
        const solAmount = 1; // 1 SOL
        const tokenAmount = 100_000; // 100k tokens
        
        if (balance < solAmount * 1e9) {
            throw new Error(`Insufficient SOL balance. Need ${solAmount} SOL but have ${balance / 1e9} SOL`);
        }

        // Create token accounts if they don't exist
        console.log('\n📝 Creating token accounts...');
        const solTokenAccount = await getAssociatedTokenAddress(
            new PublicKey('So11111111111111111111111111111111111111112'),
            wallet.publicKey
        );

        const tokenAccount = await getAssociatedTokenAddress(
            tokenMint,
            wallet.publicKey
        );

        // Create Raydium pool
        console.log('\n🏊 Creating Raydium pool...');
        // TODO: Implement Raydium pool creation
        // For now, we'll use Orca's whirlpool
        console.log('\n🌊 Creating Orca whirlpool...');
        
        // Create market on Orca
        const response = await fetch('https://api.devnet.orca.so/whirlpools', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tokenMintA: 'So11111111111111111111111111111111111111112',
                tokenMintB: tokenMint.toString(),
                tickSpacing: 64,
                initialPrice: 1,
                feeTier: 0.3
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create Orca pool: ${response.statusText}`);
        }
        
        const poolInfo = await response.json();
        console.log('\n✅ Pool created!');
        console.log('Pool Info:', poolInfo);
        
        // Save pool info
        const poolData = {
            tokenMint: tokenMint.toString(),
            solAmount,
            tokenAmount,
            poolInfo
        };
        
        fs.writeFileSync('pool-info.json', JSON.stringify(poolData, null, 2));
        console.log('\n💾 Pool info saved to pool-info.json');
        
    } catch (error) {
        console.error('\n❌ Error:', error);
    }
}

// Run the setup
setupLiquidity(); 