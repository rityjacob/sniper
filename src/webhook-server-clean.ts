import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { 
    PumpAmmSdk,
    PumpAmmInternalSdk,
    buyQuoteInputInternal
} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// 1. Setup / Imports
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Environment validation
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS;
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET;

if (!TARGET_WALLET_ADDRESS) {
    console.error('❌ TARGET_WALLET_ADDRESS environment variable is required');
    process.exit(1);
}

if (!BOT_WALLET_SECRET) {
    console.error('❌ BOT_WALLET_SECRET environment variable is required');
    process.exit(1);
}

// 2. Initialize Clients
const connection = new Connection(RPC_URL);
const botWallet = Keypair.fromSecretKey(bs58.decode(BOT_WALLET_SECRET));
const pumpAmmSdk = new PumpAmmSdk(connection);
const pumpAmmInternalSdk = new PumpAmmInternalSdk(connection);

console.log('🚀 Bot wallet initialized:', botWallet.publicKey.toString());
console.log('🎯 Target wallet:', TARGET_WALLET_ADDRESS);

// 3. Create Webhook Endpoint
app.post('/webhook', async (req: Request, res: Response) => {
    console.log('\n🔔 === WEBHOOK RECEIVED ===');
    console.log('📅 Timestamp:', new Date().toISOString());
    
    // Respond quickly to Helius
    res.status(200).json({ 
        success: true, 
        message: 'Webhook received',
        timestamp: new Date().toISOString()
    });

    // Process webhook asynchronously
    processWebhookAsync(req.body).catch(error => {
        console.error('❌ Webhook processing error:', error);
    });
});

// 4. Decode Transaction & 5. Detect Buy
async function processWebhookAsync(webhookData: any) {
    try {
        console.log('🔍 Processing webhook data...');
        
        // Extract transaction instructions and accounts
        const instructions = webhookData.instructions || [];
        const accounts = webhookData.accountData || [];
        const tokenTransfers = webhookData.tokenTransfers || [];
        const nativeTransfers = webhookData.nativeTransfers || [];
        
        console.log(`📊 Found ${instructions.length} instructions, ${accounts.length} accounts`);
        console.log(`💰 Token transfers: ${tokenTransfers.length}, Native transfers: ${nativeTransfers.length}`);
        
        // Check if target wallet is involved in this transaction
        const isTargetInvolved = checkTargetWalletInvolvement(tokenTransfers, nativeTransfers);
        
        if (!isTargetInvolved) {
            console.log('❌ Target wallet not involved in this transaction');
            return;
        }
        
        console.log('✅ Target wallet involved - analyzing transaction...');
        
        // Detect if this is a buy transaction
        const buyInfo = detectBuyTransaction(tokenTransfers, nativeTransfers);
        
        if (!buyInfo.isBuy) {
            console.log('❌ Not a buy transaction - skipping');
            return;
        }
        
        console.log('🟢 BUY TRANSACTION DETECTED!');
        console.log(`   Token: ${buyInfo.tokenMint}`);
        console.log(`   Amount: ${buyInfo.solAmount} SOL`);
        
        // 6. Execute Buy via Pump.fun
        await executePumpFunBuy(buyInfo.tokenMint, buyInfo.solAmount);
        
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
    }
}

// Check if target wallet is involved in the transaction
function checkTargetWalletInvolvement(tokenTransfers: any[], nativeTransfers: any[]): boolean {
    const targetWallet = TARGET_WALLET_ADDRESS;
    
    // Check token transfers
    const targetInTokenTransfers = tokenTransfers.some(transfer => 
        transfer.fromUserAccount === targetWallet || 
        transfer.toUserAccount === targetWallet
    );
    
    // Check native transfers (SOL)
    const targetInNativeTransfers = nativeTransfers.some(transfer => 
        transfer.fromUserAccount === targetWallet || 
        transfer.toUserAccount === targetWallet
    );
    
    return targetInTokenTransfers || targetInNativeTransfers;
}

// Detect if this is a buy transaction and extract relevant info
function detectBuyTransaction(tokenTransfers: any[], nativeTransfers: any[]): {
    isBuy: boolean;
    tokenMint: string;
    solAmount: number;
} {
    const targetWallet = TARGET_WALLET_ADDRESS;
    
    // Look for token transfers where target wallet is receiving tokens
    const targetReceivingTokens = tokenTransfers.find(transfer => 
        transfer.toUserAccount === targetWallet
    );
    
    // Look for SOL transfers where target wallet is sending SOL
    const targetSendingSol = nativeTransfers.find(transfer => 
        transfer.fromUserAccount === targetWallet
    );
    
    if (targetReceivingTokens && targetSendingSol) {
        // This looks like a buy: target sent SOL and received tokens
        const solAmount = targetSendingSol.amount / 1e9; // Convert lamports to SOL
        
        return {
            isBuy: true,
            tokenMint: targetReceivingTokens.mint,
            solAmount: solAmount
        };
    }
    
    return {
        isBuy: false,
        tokenMint: '',
        solAmount: 0
    };
}

// 6. Execute Buy via Pump.fun
async function executePumpFunBuy(tokenMint: string, amountSol: number) {
    try {
        console.log(`🚀 Executing Pump.fun buy: ${amountSol} SOL for token ${tokenMint}`);
        
        // Get swap state for the token
        const swapState = await pumpAmmSdk.swapSolanaState(
            new PublicKey(tokenMint),
            botWallet.publicKey
        );
        
        console.log('📊 Swap state retrieved:', {
            poolBaseAmount: swapState.poolBaseAmount.toString(),
            poolQuoteAmount: swapState.poolQuoteAmount.toString()
        });
        
        // Convert SOL amount to lamports
        const quoteAmount = BigInt(Math.floor(amountSol * 1e9));
        const slippage = 0.01; // 1% slippage
        
        // Calculate buy amount
        const buyCalculation = buyQuoteInputInternal(
            quoteAmount,
            slippage,
            swapState.poolBaseAmount,
            swapState.poolQuoteAmount,
            swapState.globalConfig,
            swapState.pool.creator
        );
        
        console.log('💰 Buy calculation:', {
            quoteAmount: quoteAmount.toString(),
            baseAmount: buyCalculation.base.toString(),
            maxQuote: buyCalculation.maxQuote.toString()
        });
        
        // Execute buy transaction
        const instructions = await pumpAmmInternalSdk.buyQuoteInput(
            swapState,
            quoteAmount,
            slippage
        );
        
        // Create and send transaction
        const transaction = new Transaction();
        transaction.add(...instructions);
        
        // Get latest blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = botWallet.publicKey;
        
        // Sign and send transaction
        transaction.sign(botWallet);
        
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            maxRetries: 3
        });
        
        console.log('✅ Buy transaction sent:', signature);
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
            throw new Error('Transaction failed confirmation');
        }
        
        console.log('🎉 Buy transaction confirmed:', signature);
        
    } catch (error) {
        console.error('❌ Pump.fun buy failed:', error);
        throw error;
    }
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        botWallet: botWallet.publicKey.toString(),
        targetWallet: TARGET_WALLET_ADDRESS,
        rpcUrl: RPC_URL
    });
});

// 8. Logging & Error Handling
app.use((error: any, req: Request, res: Response, next: any) => {
    console.error('❌ Server error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Pump.fun Sniper Bot running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: POST /webhook`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`🎯 Target wallet: ${TARGET_WALLET_ADDRESS}`);
    console.log(`🤖 Bot wallet: ${botWallet.publicKey.toString()}`);
});

export default app;
