import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
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

// 1. Setup / Imports
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Security middleware
app.use(helmet());

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many webhook requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Environment validation
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
// Accept both correct and common misspelled env var names
const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS || process.env.TARGET_WALLET_ADDRES;
// Support legacy/alternate env var name used in some configs
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET || process.env.WALLET_PRIVATE_KEY;
const FIXED_BUY_AMOUNT = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.08'); // Default 0.08 SOL
const SLIPPAGE_PERCENT = parseFloat(process.env.SLIPPAGE_PERCENT || '50'); // Default 50%

if (!TARGET_WALLET_ADDRESS) {
    console.error('❌ TARGET_WALLET_ADDRESS environment variable is required');
    process.exit(1);
}

if (!BOT_WALLET_SECRET) {
    console.error('❌ BOT_WALLET_SECRET (or WALLET_PRIVATE_KEY) environment variable is required');
    process.exit(1);
}

// 2. Initialize Clients
const connection = new Connection(RPC_URL);
const botWallet = Keypair.fromSecretKey(bs58.decode(BOT_WALLET_SECRET));
const pumpAmmSdk = new PumpAmmSdk();

console.log('🚀 Bot wallet initialized:', botWallet.publicKey.toString());
console.log('🎯 Target wallet:', TARGET_WALLET_ADDRESS);
console.log('💰 Fixed buy amount:', FIXED_BUY_AMOUNT, 'SOL');

// 3. Create Webhook Endpoint
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

// 4. Decode Transaction & 5. Detect Buy
async function processWebhookAsync(webhookData: any) {
    try {
        console.log('🔍 Processing webhook data...');
        
        // DEBUG: Log the complete webhook structure
        console.log('📋 COMPLETE WEBHOOK DATA:');
        console.log(JSON.stringify(webhookData, null, 2));
        
        // Handle array of transactions (Helius sends array with one transaction)
        const transaction = Array.isArray(webhookData) ? webhookData[0] : webhookData;
        
        // Extract transaction instructions and accounts
        const instructions = transaction.instructions || [];
        const accounts = transaction.accountData || [];
        const tokenTransfers = transaction.tokenTransfers || [];
        const nativeTransfers = transaction.nativeTransfers || [];
        
        console.log(`📊 Found ${instructions.length} instructions, ${accounts.length} accounts`);
        console.log(`💰 Token transfers: ${tokenTransfers.length}, Native transfers: ${nativeTransfers.length}`);
        
        // DEBUG: Check for alternative data structures
        console.log('🔍 DEBUGGING WEBHOOK STRUCTURE:');
        console.log('  - Has tokenTransfers:', !!transaction.tokenTransfers);
        console.log('  - Has nativeTransfers:', !!transaction.nativeTransfers);
        console.log('  - Has instructions:', !!transaction.instructions);
        console.log('  - Has accountData:', !!transaction.accountData);
        console.log('  - Has events:', !!transaction.events);
        console.log('  - Has logs:', !!transaction.logs);
        console.log('  - Has innerInstructions:', !!transaction.innerInstructions);
        console.log('  - Has preBalances:', !!transaction.preBalances);
        console.log('  - Has postBalances:', !!transaction.postBalances);
        console.log('  - Has preTokenBalances:', !!transaction.preTokenBalances);
        console.log('  - Has postTokenBalances:', !!transaction.postTokenBalances);
        
        // Try alternative data structures if standard ones are empty
        let finalTokenTransfers = tokenTransfers;
        let finalNativeTransfers = nativeTransfers;
        
        if (tokenTransfers.length === 0 && nativeTransfers.length === 0) {
            console.log('🔍 Trying alternative data structures...');
            
            // Try parsing from events
            if (transaction.events) {
                console.log('  - Found events, parsing...');
                // Parse events for token transfers
            }
            
            // Try parsing from logs
            if (transaction.logs) {
                console.log('  - Found logs, parsing...');
                // Parse logs for transfer information
            }
            
            // Try parsing from pre/post token balances
            if (transaction.preTokenBalances && transaction.postTokenBalances) {
                console.log('  - Found token balances, parsing...');
                finalTokenTransfers = parseTokenBalances(transaction.preTokenBalances, transaction.postTokenBalances);
            }
            
            // Try parsing from pre/post balances for SOL transfers
            if (transaction.preBalances && transaction.postBalances) {
                console.log('  - Found SOL balances, parsing...');
                finalNativeTransfers = parseSolBalances(transaction.preBalances, transaction.postBalances, transaction.accountData);
            }
        }
        
        // Check if target wallet is involved in this transaction
        const isTargetInvolved = checkTargetWalletInvolvement(finalTokenTransfers, finalNativeTransfers);
        
        if (!isTargetInvolved) {
            console.log('❌ Target wallet not involved in this transaction');
            return;
        }
        
        console.log('✅ Target wallet involved - analyzing transaction...');
        
        // Detect if this is a buy transaction
        const buyInfo = detectBuyTransaction(finalTokenTransfers, finalNativeTransfers);
        
        if (!buyInfo.isBuy) {
            console.log('❌ Not a buy transaction - skipping');
            return;
        }
        
        console.log('🟢 BUY TRANSACTION DETECTED!');
        console.log(`   Token: ${buyInfo.tokenMint}`);
        console.log(`   Target spent: ${buyInfo.solAmount} SOL`);
        console.log(`   Bot will buy: ${FIXED_BUY_AMOUNT} SOL (fixed amount)`);
        
        // 6. Execute Buy via Pump.fun with fixed amount
        await executePumpFunBuy(buyInfo.tokenMint, FIXED_BUY_AMOUNT);
        
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
    }
}

// Parse token transfers from pre/post token balances
function parseTokenBalances(preTokenBalances: any[], postTokenBalances: any[]): any[] {
    const transfers: any[] = [];
    
    // Find accounts that gained tokens
    postTokenBalances.forEach((postBalance: any) => {
        const preBalance = preTokenBalances.find((pre: any) => 
            pre.accountIndex === postBalance.accountIndex && pre.mint === postBalance.mint
        );
        
        if (preBalance) {
            const preAmount = parseFloat(preBalance.uiTokenAmount?.amount || '0');
            const postAmount = parseFloat(postBalance.uiTokenAmount?.amount || '0');
            
            if (postAmount > preAmount) {
                transfers.push({
                    fromUserAccount: 'unknown',
                    toUserAccount: postBalance.owner,
                    fromTokenAccount: 'unknown',
                    toTokenAccount: postBalance.owner,
                    mint: postBalance.mint,
                    tokenAmount: (postAmount - preAmount).toString()
                });
            }
        }
    });
    
    return transfers;
}

// Parse SOL transfers from pre/post balances
function parseSolBalances(preBalances: number[], postBalances: number[], accountData: any[]): any[] {
    const transfers: any[] = [];
    
    preBalances.forEach((preBalance: number, index: number) => {
        const postBalance = postBalances[index];
        const account = accountData?.[index];
        
        if (account && preBalance !== postBalance) {
            const amount = postBalance - preBalance;
            if (amount !== 0) {
                transfers.push({
                    fromUserAccount: amount < 0 ? account : 'unknown',
                    toUserAccount: amount > 0 ? account : 'unknown',
                    amount: Math.abs(amount)
                });
            }
        }
    });
    
    return transfers;
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
        console.log('📊 Token mint:', tokenMint);
        console.log('💰 Amount SOL:', amountSol);
        console.log('🤖 Bot wallet:', botWallet.publicKey.toString());

        // Convert SOL to lamports (1 SOL = 1e9 lamports)
        const amountLamports = new BN(Math.floor(amountSol * 1e9));
        const tokenMintPubkey = new PublicKey(tokenMint);

        // Build SwapSolanaState using the online SDK helper
        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const poolKey = canonicalPumpPoolPda(tokenMintPubkey);
        const swapState = await onlineSdk.swapSolanaState(poolKey, botWallet.publicKey);

        // Build buy instructions for a quote-in (SOL) swap
        const buyIx = await pumpAmmSdk.buyQuoteInput(swapState, amountLamports, SLIPPAGE_PERCENT);

        // Create and send transaction
        const tx = new Transaction();
        tx.add(...buyIx);
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = botWallet.publicKey;
        tx.sign(botWallet);

        console.log('📤 Sending buy transaction...');
        const signature = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        console.log('✅ Buy transaction sent:', signature);
        await connection.confirmTransaction(signature, 'confirmed');
        console.log('🎉 Buy transaction confirmed!');
        
    } catch (error) {
        console.error('❌ Pump.fun buy failed:', error);
        
        // Retry logic for common errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('pool') || errorMessage.includes('not ready')) {
            console.log('🔄 Pool not ready, retrying in 2 seconds...');
            setTimeout(() => {
                executePumpFunBuy(tokenMint, amountSol);
            }, 2000);
        } else {
            throw error;
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
        fixedBuyAmount: FIXED_BUY_AMOUNT,
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

// Self-ping function to keep server awake on Render
function startSelfPing() {
    const pingInterval = 14 * 60 * 1000; // 14 minutes in milliseconds
    // Accept either Render-provided URL or a custom SELF_URL
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

    // Start the ping interval
    setInterval(pingServer, pingInterval);
    
    // Initial ping
    pingServer();
    
    console.log(`🔄 Self-ping started - pinging every ${pingInterval / 1000 / 60} minutes`);
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Pump.fun Sniper Bot running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: POST /webhook`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`🎯 Target wallet: ${TARGET_WALLET_ADDRESS}`);
    console.log(`🤖 Bot wallet: ${botWallet.publicKey.toString()}`);
    console.log(`💰 Fixed buy amount: ${FIXED_BUY_AMOUNT} SOL`);
    
    // Start self-ping to keep server awake
    startSelfPing();
});

export default app; 