import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_PROGRAM_ID,
    MINT_SIZE,
    createInitializeMintInstruction,
    getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import { RPC_URL } from '../config';
import * as fs from 'fs';

async function createTestToken() {
    try {
        console.log('🚀 Creating test token on devnet...');
        
        // Load wallet from target-wallet.json
        const targetWalletPath = 'target-wallet.json';
        const targetWalletData = JSON.parse(fs.readFileSync(targetWalletPath, 'utf-8'));
        const wallet = Keypair.fromSecretKey(new Uint8Array(targetWalletData));
        
        console.log('👛 Using wallet:', wallet.publicKey.toString());
        
        // Connect to devnet
        const connection = new Connection(RPC_URL, 'confirmed');
        
        // Create new token mint
        console.log('\n🔨 Creating token mint...');
        const mint = Keypair.generate();
        
        // Calculate rent for token mint
        const lamports = await getMinimumBalanceForRentExemptMint(connection);
        
        // Create mint account
        const createMintAccountIx = SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: mint.publicKey,
            space: MINT_SIZE,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        });
        
        // Initialize mint
        const initMintIx = createInitializeMintInstruction(
            mint.publicKey,
            9, // 9 decimals
            wallet.publicKey,
            wallet.publicKey
        );
        
        // Create and send transaction
        const transaction = new Transaction().add(createMintAccountIx, initMintIx);
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [wallet, mint]
        );
        
        console.log('✅ Token mint created!');
        console.log('Mint Address:', mint.publicKey.toString());
        console.log('Transaction:', signature);
        
        // Create token account for the wallet
        console.log('\n📝 Creating token account...');
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            wallet,
            mint.publicKey,
            wallet.publicKey
        );
        
        console.log('Token Account:', tokenAccount.address.toString());
        
        // Mint some tokens
        console.log('\n💰 Minting initial supply...');
        const mintAmount = 1_000_000_000; // 1 billion tokens
        const mintSignature = await mintTo(
            connection,
            wallet,
            mint.publicKey,
            tokenAccount.address,
            wallet,
            mintAmount
        );
        
        console.log('✅ Tokens minted!');
        console.log('Mint Transaction:', mintSignature);
        
        // Save token info to a file
        const tokenInfo = {
            mint: mint.publicKey.toString(),
            tokenAccount: tokenAccount.address.toString(),
            decimals: 9,
            initialSupply: mintAmount
        };
        
        fs.writeFileSync('test-token.json', JSON.stringify(tokenInfo, null, 2));
        console.log('\n💾 Token info saved to test-token.json');
        
        console.log('\n📋 Token Details:');
        console.log('Mint Address:', tokenInfo.mint);
        console.log('Token Account:', tokenInfo.tokenAccount);
        console.log('Decimals:', tokenInfo.decimals);
        console.log('Initial Supply:', tokenInfo.initialSupply);
        
    } catch (error) {
        console.error('❌ Error creating token:', error);
    }
}

createTestToken().catch(console.error); 