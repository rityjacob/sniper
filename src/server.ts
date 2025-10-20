import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Connection, PublicKey, Keypair, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
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
// Accept both correct and common misspelled env var names
const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS || process.env.TARGET_WALLET_ADDRES;
// Support legacy/alternate env var name used in some configs
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET || process.env.WALLET_PRIVATE_KEY;
const FIXED_SOL_PER_TRADE = parseFloat(process.env.FIXED_SOL_PER_TRADE || '0.02'); // Default 0.02 SOL
// Backward-compat slippage config: prefer SLIPPAGE_BPS (basis points). If only SLIPPAGE_PERCENT provided, convert to bps
const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || (process.env.SLIPPAGE_PERCENT ? String(Number(process.env.SLIPPAGE_PERCENT) * 100) : '4000')); // default 4000 (40%)

// Reserve headroom in lamports to cover ATA rent + fees so swap input doesn't get squeezed and trip slippage
// Defaults to ~0.005 SOL
const HEADROOM_LAMPORTS = parseInt(process.env.HEADROOM_LAMPORTS || String(Math.floor(0.01 * 1e9))); // default 0.01 SOL

// Keep a reserve so we don't drain wallet below fees/rent. Default 0.02 SOL
const RESERVE_LAMPORTS = parseInt(process.env.RESERVE_LAMPORTS || String(Math.floor(0.02 * 1e9)));

// Compute budget defaults
const DEFAULT_CU_LIMIT = parseInt(process.env.COMPUTE_UNIT_LIMIT || '200000');
const MIN_CU_PRICE_MICROLAMPORTS = parseInt(process.env.COMPUTE_UNIT_PRICE || '10000');

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
console.log('💰 Fixed buy amount:', FIXED_SOL_PER_TRADE, 'SOL');

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
        console.log(`   Bot will buy: ${FIXED_SOL_PER_TRADE} SOL (fixed amount)`);
        
        // 6. Execute Buy via Pump.fun with fixed amount
        await executePumpFunBuy(buyInfo.tokenMint, FIXED_SOL_PER_TRADE);
        
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

// Pre-transaction balance validation
async function validateBalance(amountSol: number): Promise<void> {
    const currentBalanceLamports = await connection.getBalance(botWallet.publicKey);
    const currentBalanceSol = currentBalanceLamports / 1e9;
    
    // Simple check: ensure we have the amount + a reasonable buffer for fees
    // ATA rent exemption is the main cost (~0.002 SOL), plus some buffer for transaction fees
    const BUFFER_SOL = 0.01; // 0.01 SOL buffer should be more than enough
    const requiredBalance = amountSol + BUFFER_SOL;
    
    console.log(`💰 Balance check: Current=${currentBalanceSol.toFixed(6)} SOL, Required=${requiredBalance.toFixed(6)} SOL (amount=${amountSol.toFixed(6)} + buffer=${BUFFER_SOL.toFixed(6)})`);
    
    if (currentBalanceSol < requiredBalance) {
        const shortfall = requiredBalance - currentBalanceSol;
        throw new Error(`Insufficient balance: Need ${requiredBalance.toFixed(6)} SOL but only have ${currentBalanceSol.toFixed(6)} SOL. Shortfall: ${shortfall.toFixed(6)} SOL`);
    }
}

// 6. Execute Buy via Pump.fun
async function executePumpFunBuy(tokenMint: string, amountSol: number, attempt: number = 0) {
    try {
        console.log(`🚀 Executing Pump.fun buy: ${amountSol} SOL for token ${tokenMint}`);
        console.log('📊 Token mint:', tokenMint);
        console.log('💰 Amount SOL:', amountSol);
        console.log('🤖 Bot wallet:', botWallet.publicKey.toString());

        // Validate balance before attempting transaction
        await validateBalance(amountSol);

        // Convert SOL to lamports (1 SOL = 1e9 lamports)
        const amountLamportsRawDesired = Math.floor(amountSol * 1e9);
        const amountLamports = new BN(amountLamportsRawDesired);

        // Get current balance for logging
        const currentBalanceLamports = await connection.getBalance(botWallet.publicKey);
        const currentBalanceSol = currentBalanceLamports / 1e9;
        
        console.log(`🧮 Transaction details: balance=${currentBalanceSol.toFixed(6)} SOL, buying=${amountSol.toFixed(6)} SOL, reserve=${(RESERVE_LAMPORTS/1e9).toFixed(6)} SOL`);
        const tokenMintPubkey = new PublicKey(tokenMint);

        // Build SwapSolanaState using the online SDK helper
        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const poolKey = canonicalPumpPoolPda(tokenMintPubkey);
        const swapState = await onlineSdk.swapSolanaState(poolKey, botWallet.publicKey);

        // Build buy instructions for a quote-in (SOL) swap using slippage in basis points
        const buyIx = await pumpAmmSdk.buyQuoteInput(swapState, amountLamports, SLIPPAGE_BPS);

        // Create and send transaction
        const tx = new Transaction();

        // Prepend compute budget Ixs with dynamic CU price for faster inclusion
        const cuPrice = await getDynamicComputeUnitPrice(connection, botWallet.publicKey, MIN_CU_PRICE_MICROLAMPORTS);
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: DEFAULT_CU_LIMIT }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));

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

        // If SendTransactionError, try to surface logs for quicker diagnosis
        // @ts-ignore
        const logs: string[] | undefined = (error && (error.logs || error.transactionLogs)) as any;
        if (logs && Array.isArray(logs)) {
            console.error('🔎 Program logs:\n' + logs.join('\n'));
        }
        
        // Check for insufficient balance errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        const insufficientBalance = errorMessage.includes('insufficient lamports') || 
                                   errorMessage.includes('Insufficient balance') ||
                                   (logs || []).some(l => l.includes('insufficient lamports'));
        
        if (insufficientBalance) {
            console.error('💸 INSUFFICIENT BALANCE ERROR:');
            console.error('   The wallet does not have enough SOL to complete this transaction.');
            console.error('   This includes the buy amount + transaction fees + ATA rent + reserve.');
            console.error('   Please fund the wallet with more SOL and try again.');
            console.error(`   Current error: ${errorMessage}`);
            return; // Don't retry on insufficient balance
        }
        
        // Retry logic for common errors
        const exceededSlippage = errorMessage.includes('ExceededSlippage') || (logs || []).some(l => l.includes('ExceededSlippage'));
        if (exceededSlippage && attempt < 3) {
            // Strategy: on slippage, try one of two mitigations:
            // 1) reduce effective input by an additional 2% each attempt
            // 2) re-execute quickly with fresh swap state
            const reducedAmountSol = amountSol * (1 - 0.02 * (attempt + 1));
            console.log(`🔁 Exceeded slippage; retrying attempt ${attempt + 1} with reduced amount ${reducedAmountSol.toFixed(6)} SOL`);
            return await executePumpFunBuy(tokenMint, reducedAmountSol, attempt + 1);
        }
        if (errorMessage.includes('pool') || errorMessage.includes('not ready')) {
            console.log('🔄 Pool not ready, retrying in 2 seconds...');
            setTimeout(() => {
                executePumpFunBuy(tokenMint, amountSol, attempt + 1);
            }, 2000);
        } else {
            throw error;
        }
    }
}

// Estimate a competitive compute unit price based on recent fees, with a floor to ensure minimum speed
async function getDynamicComputeUnitPrice(conn: Connection, account: PublicKey, floorMicrolamports: number): Promise<number> {
    try {
        // @ts-ignore - available on recent web3.js versions (Helius supports it)
        const recent = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: [account] });
        if (!recent || !Array.isArray(recent) || recent.length === 0) return floorMicrolamports;

        // Compute median fee per CU if computeUnitLimit is present; otherwise fallback to priority fees
        const feesPerCu: number[] = [];
        for (const f of recent) {
            const cuLimit = (f as any).computeUnitLimit || DEFAULT_CU_LIMIT;
            if (typeof f.prioritizationFee === 'number' && cuLimit > 0) {
                feesPerCu.push(Math.floor(f.prioritizationFee / cuLimit));
            }
        }
        if (feesPerCu.length === 0) return floorMicrolamports;
        feesPerCu.sort((a, b) => a - b);
        const median = feesPerCu[Math.floor(feesPerCu.length / 2)];
        const boosted = Math.max(Math.floor(median * 1.1), floorMicrolamports); // +10% above median
        return boosted;
    } catch {
        return floorMicrolamports;
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
    console.log(`💰 Fixed buy amount: ${FIXED_SOL_PER_TRADE} SOL`);
    
    // Start self-ping to keep server awake
    startSelfPing();
});

export default app; 