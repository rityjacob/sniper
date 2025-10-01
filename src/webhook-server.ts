import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { 
    Connection, 
    PublicKey, 
    Keypair, 
    Transaction, 
    ComputeBudgetProgram,
    SystemProgram,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress,
    createInitializeAccountInstruction,
    createCloseAccountInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { 
    createAssociatedTokenAccountInstruction,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import BN from 'bn.js';
import { 
    PumpAmmSdk,
    OnlinePumpAmmSdk,
    canonicalPumpPoolPda
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
// Support multiple target wallets via comma-separated TARGET_WALLET_ADDRESSES; fallback to TARGET_WALLET_ADDRESS
const TARGET_WALLET_ADDRESSES: string[] = (process.env.TARGET_WALLET_ADDRESSES || process.env.TARGET_WALLET_ADDRESS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET;
const FIXED_BUY_AMOUNT = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.08'); // Default 0.08 SOL
const SLIPPAGE_PERCENT = parseFloat(process.env.SLIPPAGE_PERCENT || '35'); // Default 25%
const COMPUTE_UNIT_LIMIT = parseInt(process.env.COMPUTE_UNIT_LIMIT || '200000'); // Default 164,940 units
const COMPUTE_UNIT_PRICE = parseInt(process.env.COMPUTE_UNIT_PRICE || '1665000'); // Default 1,364,133 micro lamports
// Fast pool check controls
const POOL_CHECK_RETRIES = parseInt(process.env.POOL_CHECK_RETRIES || '4'); // total ~ 1.2s with default interval
const POOL_CHECK_INTERVAL_MS = parseInt(process.env.POOL_CHECK_INTERVAL_MS || '300');

if (TARGET_WALLET_ADDRESSES.length === 0) {
    console.error('❌ TARGET_WALLET_ADDRESSES or TARGET_WALLET_ADDRESS environment variable is required');
    process.exit(1);
}

if (!BOT_WALLET_SECRET) {
    console.error('❌ BOT_WALLET_SECRET environment variable is required');
  process.exit(1);
}

// 2. Initialize Clients
const connection = new Connection(RPC_URL);
const botWallet = Keypair.fromSecretKey(bs58.decode(BOT_WALLET_SECRET));
const pumpAmmSdk = new PumpAmmSdk();

console.log('🚀 Bot wallet initialized:', botWallet.publicKey.toString());
console.log('🎯 Target wallet(s):', TARGET_WALLET_ADDRESSES.join(', '));
console.log('💰 Fixed buy amount:', FIXED_BUY_AMOUNT, 'SOL');
console.log('⚡ Compute unit limit:', COMPUTE_UNIT_LIMIT);
console.log('💸 Compute unit price:', COMPUTE_UNIT_PRICE, 'micro lamports');

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
    // Check token transfers against any target wallet
    const targetInTokenTransfers = tokenTransfers.some(transfer => 
        TARGET_WALLET_ADDRESSES.includes(transfer.fromUserAccount) || 
        TARGET_WALLET_ADDRESSES.includes(transfer.toUserAccount)
    );
    
    // Check native transfers (SOL) against any target wallet
    const targetInNativeTransfers = nativeTransfers.some(transfer => 
        TARGET_WALLET_ADDRESSES.includes(transfer.fromUserAccount) || 
        TARGET_WALLET_ADDRESSES.includes(transfer.toUserAccount)
    );
    
    return targetInTokenTransfers || targetInNativeTransfers;
}

// Detect if this is a buy transaction and extract relevant info
function detectBuyTransaction(tokenTransfers: any[], nativeTransfers: any[]): {
    isBuy: boolean;
    tokenMint: string;
    solAmount: number;
} {
    // Look for token transfers where any target wallet is receiving tokens
    const targetReceivingTokens = tokenTransfers.find(transfer => 
        TARGET_WALLET_ADDRESSES.includes(transfer.toUserAccount)
    );
    
    // Look for SOL transfers where any target wallet is sending SOL
    const targetSendingSol = nativeTransfers.find(transfer => 
        TARGET_WALLET_ADDRESSES.includes(transfer.fromUserAccount)
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

// Ensure the associated token account exists for a given mint; create it in a separate tx if missing
async function ensureAtaExists(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const info = await connection.getAccountInfo(ata);
    if (info) {
        return ata;
    }

    console.log('🛠️  Creating ATA in a separate transaction:', ata.toString());
    const tx = new Transaction();
    tx.add(
        createAssociatedTokenAccountInstruction(
            botWallet.publicKey,
            ata,
            owner,
            mint
        )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = botWallet.publicKey;
    tx.sign(botWallet);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
    console.log('✅ ATA creation tx sent:', sig);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('✅ ATA confirmed');
    return ata;
}

// 6. Execute Buy via Pump.fun with target bot instruction order
async function executePumpFunBuy(tokenMint: string, amountSol: number, retryCount: number = 0) {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds
    
    try {
        console.log(`🚀 Executing Pump.fun buy: ${amountSol} SOL for token ${tokenMint}`);
        console.log('📊 Token mint:', tokenMint);
        console.log('💰 Amount SOL:', amountSol);
        console.log('🤖 Bot wallet:', botWallet.publicKey.toString());
        console.log('⚡ Compute units:', COMPUTE_UNIT_LIMIT);
        console.log('💸 Priority fee:', COMPUTE_UNIT_PRICE, 'micro lamports (~', (COMPUTE_UNIT_PRICE * COMPUTE_UNIT_LIMIT / 1e9).toFixed(6), 'SOL)');
        console.log('📈 Slippage tolerance:', SLIPPAGE_PERCENT + '%');

        // Convert SOL to lamports (1 SOL = 1e9 lamports)
        const amountLamports = new BN(Math.floor(amountSol * 1e9));
        const tokenMintPubkey = new PublicKey(tokenMint);

        // Build SwapSolanaState using the online SDK helper
        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const poolKey = canonicalPumpPoolPda(tokenMintPubkey);
        console.log('🧩 Derived pool PDA:', poolKey.toString());

        // Wait briefly for pool account to appear (fast, configurable)
        let poolInfo = await connection.getAccountInfo(poolKey);
        let attempts = 0;
        while (!poolInfo && attempts < POOL_CHECK_RETRIES) {
            await new Promise((r) => setTimeout(r, POOL_CHECK_INTERVAL_MS));
            poolInfo = await connection.getAccountInfo(poolKey);
            attempts++;
        }
        if (!poolInfo) {
            throw new Error('Pool account not found (fast check)');
        }

        console.log('✅ Pool account is present, fetching swap state...');
        const swapState = await onlineSdk.swapSolanaState(poolKey, botWallet.publicKey);

        // Build buy instructions for a quote-in (SOL) swap
        const buyIx = await pumpAmmSdk.buyQuoteInput(swapState, amountLamports, SLIPPAGE_PERCENT);

        // Create transaction with simplified structure
        const tx = new Transaction();

        // 1. ComputeBudgetProgram.setComputeUnitLimit (configurable via COMPUTE_UNIT_LIMIT)
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));

        // 2. ComputeBudgetProgram.setComputeUnitPrice (configurable via COMPUTE_UNIT_PRICE)
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }));

        // 3. Ensure ATA exists ahead of time (separate tx)
        await ensureAtaExists(botWallet.publicKey, tokenMintPubkey);

        // 4. Pump.fun AMM.buy (the actual buy instruction)
        tx.add(...buyIx);

        // Set transaction properties
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = botWallet.publicKey;
        tx.sign(botWallet);

        console.log('📤 Sending buy transaction with target bot instruction order...');
        const signature = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        console.log('✅ Buy transaction sent:', signature);
        await connection.confirmTransaction(signature, 'confirmed');
        console.log('🎉 Buy transaction confirmed!');
        
    } catch (error) {
        console.error('❌ Pump.fun buy failed:', error);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Handle specific error cases
        if (errorMessage.includes('Pool account not found')) {
            console.log('⚠️  Pool not found - token may not have a Pump.fun pool yet');
            console.log('💡 This usually means the token is too new or not on Pump.fun');
            return; // Don't retry for pool not found
        }
        
        if (errorMessage.includes('ExceededSlippage') || errorMessage.includes('0x1774')) {
            console.log('⚠️  Slippage exceeded - price moved too much');
            console.log('💡 Consider increasing SLIPPAGE_PERCENT or reducing FIXED_BUY_AMOUNT');
            return; // Don't retry for slippage - it won't get better
        }
        
        if (errorMessage.includes('pool') || errorMessage.includes('not ready') || errorMessage.includes('simulation failed')) {
            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying in ${retryDelay/1000} seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                setTimeout(() => {
                    executePumpFunBuy(tokenMint, amountSol, retryCount + 1);
                }, retryDelay);
                return;
            } else {
                console.log('❌ Max retries reached, giving up');
                return;
            }
        }
        
        // For other errors, don't retry
        console.log('❌ Non-retryable error:', errorMessage);
    }
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
        res.status(200).json({
        status: 'healthy',
            timestamp: new Date().toISOString(),
        botWallet: botWallet.publicKey.toString(),
        targetWallets: TARGET_WALLET_ADDRESSES,
        fixedBuyAmount: FIXED_BUY_AMOUNT,
        slippagePercent: SLIPPAGE_PERCENT,
        computeUnitLimit: COMPUTE_UNIT_LIMIT,
        computeUnitPrice: COMPUTE_UNIT_PRICE,
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
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `https://sniper-tup2.onrender.com`;
    
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
    console.log(`🎯 Target wallets: ${TARGET_WALLET_ADDRESSES.join(', ')}`);
    console.log(`🤖 Bot wallet: ${botWallet.publicKey.toString()}`);
    console.log(`💰 Fixed buy amount: ${FIXED_BUY_AMOUNT} SOL`);
    console.log(`⚡ Compute unit limit: ${COMPUTE_UNIT_LIMIT}`);
    console.log(`💸 Compute unit price: ${COMPUTE_UNIT_PRICE} micro lamports`);
    
    // Start self-ping to keep server awake
startSelfPing();
});

export default app;


