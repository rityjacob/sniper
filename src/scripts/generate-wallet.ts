import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

async function generateWallet() {
    try {
        // Generate new keypair
        const keypair = Keypair.generate();
        
        // Get private key in base58 format
        const privateKey = bs58.encode(keypair.secretKey);
        
        // Get public key
        const publicKey = keypair.publicKey.toString();
        
        console.log('\n🔑 Generated new wallet:');
        console.log(`Public Key: ${publicKey}`);
        console.log(`Private Key (base58): ${privateKey}`);
        
        // Save to target-wallet.json
        const walletPath = path.join(process.cwd(), 'target-wallet.json');
        fs.writeFileSync(walletPath, JSON.stringify(Array.from(keypair.secretKey)));
        console.log(`\n💾 Saved keypair to: ${walletPath}`);
        
        // Create or update .env file
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';
        
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
        }
        
        // Update or add WALLET_PRIVATE_KEY
        if (envContent.includes('WALLET_PRIVATE_KEY=')) {
            envContent = envContent.replace(
                /WALLET_PRIVATE_KEY=.*/,
                `WALLET_PRIVATE_KEY=${privateKey}`
            );
        } else {
            envContent += `\nWALLET_PRIVATE_KEY=${privateKey}`;
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log(`\n💾 Updated .env file with new private key`);
        
        console.log('\n⚠️  IMPORTANT:');
        console.log('1. Make sure to fund this wallet with some SOL on devnet');
        console.log('2. Keep your private key secure and never share it');
        console.log('3. You can get devnet SOL from: https://solfaucet.com/');
        
    } catch (error) {
        console.error('Error generating wallet:', error);
    }
}

generateWallet().catch(console.error); 