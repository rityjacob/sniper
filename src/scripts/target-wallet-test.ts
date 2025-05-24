import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { RPC_URL } from '../config';
import { dexManager } from '../dex';
import { walletManager } from '../wallet';
import { transactionManager } from '../transaction';
import * as fs from 'fs';
import 'dotenv/config';

async function simulateTargetWalletPurchase() {
    try {
        // Load target wallet from file
        const targetWalletPath = process.env.TARGET_WALLET_PATH || 'target-wallet.json';
        const targetWalletData = JSON.parse(fs.readFileSync(targetWalletPath, 'utf-8'));
        const targetWallet = Keypair.fromSecretKey(new Uint8Array(targetWalletData));

        console.log('🎯 Target Wallet Address:', targetWallet.publicKey.toString());

        // Connect to mainnet
        const connection = new Connection(RPC_URL, 'confirmed');
        
        // Get token to buy
        const tokenAddress = process.env.TOKEN_ADDRESS;
        if (!tokenAddress) {
            throw new Error('Please set TOKEN_ADDRESS in .env file');
        }

        // Amount to buy (in SOL)
        const amount = process.env.BUY_AMOUNT ? parseFloat(process.env.BUY_AMOUNT) : 0.1;
        
        console.log('\n📊 Purchase Details:');
        console.log(`Token: ${tokenAddress}`);
        console.log(`Amount: ${amount} SOL`);

        // Check wallet balance
        const balance = await connection.getBalance(targetWallet.publicKey);
        console.log(`\n💰 Wallet Balance: ${balance / 1e9} SOL`);

        if (balance < amount * 1e9) {
            throw new Error(`Insufficient balance. Need ${amount} SOL but have ${balance / 1e9} SOL`);
        }

        // Create a mock transaction for the target wallet
        const mockTransaction = {
            signature: 'mock-signature',
            timestamp: Date.now(),
            tokenAddress: tokenAddress,
            amount: amount.toString(),
            type: 'buy' as const
        };

        // Process the transaction through our safety checks
        console.log('\n🔍 Running safety checks...');
        const isSafe = await transactionManager.processTransaction(mockTransaction);
        
        if (!isSafe) {
            throw new Error('Transaction failed safety checks');
        }

        // Temporarily set the wallet manager to use target wallet
        const originalWallet = walletManager.getCurrentWallet();
        walletManager.setCurrentWallet(targetWallet);

        try {
            // Execute the swap
            console.log('\n🔄 Executing swap...');
            const signature = await dexManager.executeSwap(
                tokenAddress,
                amount
            );

            console.log('\n✅ Purchase completed!');
            console.log(`Transaction signature: ${signature}`);
            
            // Wait for confirmation
            const confirmation = await connection.confirmTransaction(signature);
            console.log('\n📝 Transaction confirmed:', confirmation);
        } finally {
            // Restore original wallet
            walletManager.setCurrentWallet(originalWallet);
        }

    } catch (error) {
        console.error('\n❌ Error:', error);
    }
}

// Run the simulation
simulateTargetWalletPurchase();