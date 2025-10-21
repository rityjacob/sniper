import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Connection, PublicKey, Keypair, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { 
    Token
} from '@solana/spl-token';
import { RPC_URL } from './config';
import BN from 'bn.js';
import { 
    PumpAmmSdk,
    OnlinePumpAmmSdk,
    canonicalPumpPoolPda
} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

// Simple configuration
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(helmet());

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many webhook requests from this IP, please try again later.',
});

// Environment variables
const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS;
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET || process.env.WALLET_PRIVATE_KEY;
const FIXED_SOL_PER_TRADE = parseFloat(process.env.FIXED_SOL_PER_TRADE || '0.02'); // Default 0.02 SOL
const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || '5000'); // Default 50% slippage for pump.fun

// Validation
if (!TARGET_WALLET_ADDRESS) {
    console.error('❌ TARGET_WALLET_ADDRESS environment variable is required');
    process.exit(1);
}

if (!BOT_WALLET_SECRET) {
    console.error('❌ BOT_WALLET_SECRET environment variable is required');
    process.exit(1);
}

// Initialize clients
const connection = new Connection(RPC_URL);
const botWallet = Keypair.fromSecretKey(bs58.decode(BOT_WALLET_SECRET));
const pumpAmmSdk = new PumpAmmSdk();

console.log('🚀 Simple Copy Trading Bot Started');
console.log('🎯 Target wallet:', TARGET_WALLET_ADDRESS);
console.log('🤖 Bot wallet:', botWallet.publicKey.toString());
console.log('💰 Fixed buy amount:', FIXED_SOL_PER_TRADE, 'SOL');

// Webhook endpoint for Helius
app.post('/webhook', webhookLimiter, async (req: Request, res: Response) => {
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

// Process webhook data
async function processWebhookAsync(webhookData: any) {
    try {
        console.log('🔍 Processing webhook data...');
        
        // Handle array of transactions (Helius sends array with one transaction)
        const transaction = Array.isArray(webhookData) ? webhookData[0] : webhookData;
        
        // Extract transaction data
        const tokenTransfers = transaction.tokenTransfers || [];
        const nativeTransfers = transaction.nativeTransfers || [];
        
        console.log(`📊 Found ${tokenTransfers.length} token transfers, ${nativeTransfers.length} native transfers`);
        
        // Check if target wallet is involved
        if (!isTargetWalletInvolved(tokenTransfers, nativeTransfers)) {
            console.log('❌ Target wallet not involved in this transaction');
            return;
        }
        
        console.log('✅ Target wallet involved - analyzing transaction...');
        
        // Detect buy transaction
        const buyInfo = detectBuyTransaction(tokenTransfers, nativeTransfers);
        
        if (!buyInfo.isBuy) {
            console.log('❌ Not a buy transaction - skipping');
            return;
        }
        
        console.log('🟢 BUY TRANSACTION DETECTED!');
        console.log(`   Token: ${buyInfo.tokenMint}`);
        console.log(`   Target spent: ${buyInfo.solAmount} SOL`);
        console.log(`   Bot will buy: ${FIXED_SOL_PER_TRADE} SOL (fixed amount)`);
        
        // Execute copy trade
        await executeCopyTrade(buyInfo.tokenMint);
        
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
    }
}

// Check if target wallet is involved in the transaction
function isTargetWalletInvolved(tokenTransfers: any[], nativeTransfers: any[]): boolean {
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

// Detect if this is a buy transaction
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

// Ensure token account exists
async function ensureTokenAccountExists(tokenMint: PublicKey): Promise<PublicKey> {
    const ataAddress = await Token.getAssociatedTokenAddress(
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), // Associated Token Program ID
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // Token Program ID
        tokenMint,
        botWallet.publicKey
    );
    
    try {
        // Check if ATA already exists
        const accountInfo = await connection.getAccountInfo(ataAddress);
        if (accountInfo) {
            console.log(`✅ Token account already exists: ${ataAddress.toString()}`);
            return ataAddress;
        }
    } catch (error) {
        console.log(`🔍 Token account doesn't exist, will create: ${ataAddress.toString()}`);
    }
    
    // Create ATA
    const createAtaIx = Token.createAssociatedTokenAccountInstruction(
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), // Associated Token Program ID
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // Token Program ID
        tokenMint, // mint
        ataAddress, // associated account
        botWallet.publicKey, // owner
        botWallet.publicKey // payer
    );
    
    const tx = new Transaction().add(createAtaIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = botWallet.publicKey;
    tx.sign(botWallet);
    
    console.log('🏗️ Creating token account...');
    const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
    });
    
    await connection.confirmTransaction(signature, 'confirmed');
    console.log(`✅ Token account created: ${signature}`);
    
    return ataAddress;
}

// Execute copy trade using Pump.fun
async function executeCopyTrade(tokenMint: string) {
    try {
        console.log(`🚀 Executing copy trade: ${FIXED_SOL_PER_TRADE} SOL for token ${tokenMint}`);
        
        // Validate balance
        const currentBalance = await connection.getBalance(botWallet.publicKey);
        const currentBalanceSol = currentBalance / 1e9;
        const requiredBalance = FIXED_SOL_PER_TRADE + 0.01; // Add buffer for fees
        
        if (currentBalanceSol < requiredBalance) {
            throw new Error(`Insufficient balance: Need ${requiredBalance} SOL but only have ${currentBalanceSol} SOL`);
        }
        
        // Convert SOL to lamports
        const amountLamports = new BN(Math.floor(FIXED_SOL_PER_TRADE * 1e9));
        const tokenMintPubkey = new PublicKey(tokenMint);
        
        // Ensure token account exists
        await ensureTokenAccountExists(tokenMintPubkey);
        
        // Build swap using Pump.fun SDK
        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const poolKey = canonicalPumpPoolPda(tokenMintPubkey);
        const swapState = await onlineSdk.swapSolanaState(poolKey, botWallet.publicKey);
        
        // Build buy instructions
        const buyIx = await pumpAmmSdk.buyQuoteInput(swapState, amountLamports, SLIPPAGE_BPS);
        
        // Create and send transaction
        const tx = new Transaction();
        
        // Add compute budget instructions
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));
        
        tx.add(...buyIx);
        
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = botWallet.publicKey;
        tx.sign(botWallet);
        
        console.log('📤 Sending copy trade transaction...');
        const signature = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        
        console.log('✅ Copy trade transaction sent:', signature);
        await connection.confirmTransaction(signature, 'confirmed');
        console.log('🎉 Copy trade completed successfully!');
        
    } catch (error) {
        console.error('❌ Copy trade failed:', error);
        
        // Log transaction logs if available
        const logs = (error as any)?.logs;
        if (logs && Array.isArray(logs)) {
            console.error('🔎 Program logs:\n' + logs.join('\n'));
        }
    }
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        botWallet: botWallet.publicKey.toString(),
        targetWallet: TARGET_WALLET_ADDRESS,
        fixedBuyAmount: FIXED_SOL_PER_TRADE,
        rpcUrl: RPC_URL
    });
});

// Error handling
app.use((error: any, req: Request, res: Response, next: any) => {
    console.error('❌ Server error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// Self-ping function to keep server awake
function startSelfPing() {
    const pingInterval = 14 * 60 * 1000; // 14 minutes
    const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || `https://sniper-tup2.onrender.com`;
    
    const pingServer = async () => {
        try {
            const response = await fetch(`${serverUrl}/health`);
            if (response.ok) {
                console.log(`✅ Self-ping successful at ${new Date().toISOString()}`);
            } else {
                console.log(`⚠️  Self-ping failed with status: ${response.status}`);
            }
        } catch (error) {
            console.error(`❌ Self-ping error:`, error);
        }
    };

    setInterval(pingServer, pingInterval);
    pingServer(); // Initial ping
    
    console.log(`🔄 Self-ping started - pinging every ${pingInterval / 1000 / 60} minutes`);
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Simple Copy Trading Bot running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: POST /webhook`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`🎯 Target wallet: ${TARGET_WALLET_ADDRESS}`);
    console.log(`🤖 Bot wallet: ${botWallet.publicKey.toString()}`);
    console.log(`💰 Fixed buy amount: ${FIXED_SOL_PER_TRADE} SOL`);
    
    // Start self-ping to keep server awake
    startSelfPing();
});

export default app;