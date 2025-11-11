import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Connection, PublicKey, Keypair, Transaction, ComputeBudgetProgram, SendTransactionError, SystemProgram } from '@solana/web3.js';
import { 
    Token
} from '@solana/spl-token';
import { RPC_URL, HELIUS_API_KEY, COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE } from './config';
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
        
        // Get current balance
        const currentBalance = await connection.getBalance(botWallet.publicKey);
        const currentBalanceSol = currentBalance / 1e9;
        
        // Enhanced balance validation - need more SOL for transaction fees
        const minimumRequiredBalance = 0.01; // Increased minimum to account for priority fees
        const feeBuffer = 0.005; // Buffer for transaction fees
        
        if (currentBalanceSol < minimumRequiredBalance) {
            throw new Error(`INSUFFICIENT BALANCE: Need at least ${minimumRequiredBalance} SOL for trading, but only have ${currentBalanceSol.toFixed(6)} SOL. Please fund the bot wallet.`);
        }
        
        // ALWAYS use exactly FIXED_SOL_PER_TRADE, regardless of target's purchase amount
        // This ensures we buy a fixed amount (0.02 SOL) every time
        const actualTradeAmount = FIXED_SOL_PER_TRADE;
        
        console.log(`💰 Fixed trade amount: ${actualTradeAmount.toFixed(6)} SOL (always ${FIXED_SOL_PER_TRADE} SOL regardless of target's purchase)`);
        
        // Validate we have enough balance for the fixed trade amount + fees
        // Need: trade amount + transaction fees (~0.001 SOL) + small buffer
        const minimumRequiredForTrade = actualTradeAmount + 0.005; // 0.005 SOL buffer for fees
        
        if (currentBalanceSol < minimumRequiredForTrade) {
            throw new Error(
                `INSUFFICIENT BALANCE: Need at least ${minimumRequiredForTrade.toFixed(6)} SOL ` +
                `(${actualTradeAmount.toFixed(6)} SOL for trade + 0.005 SOL for fees), ` +
                `but only have ${currentBalanceSol.toFixed(6)} SOL. ` +
                `Please fund the bot wallet with more SOL.`
            );
        }
        
        // Convert SOL to lamports - use exact fixed amount
        const amountLamports = Math.floor(actualTradeAmount * 1e9);
        const amountBN = new BN(amountLamports);
        
        console.log(`💵 Exact trade amount: ${actualTradeAmount.toFixed(6)} SOL (${amountLamports} lamports)`);
        
        const tokenMintPubkey = new PublicKey(tokenMint);
        
        // Ensure token account exists BEFORE building swap
        // This prevents the SDK from trying to create it and requiring extra SOL
        const tokenAccount = await ensureTokenAccountExists(tokenMintPubkey);
        
        // Check balance after token account creation (creation costs ~0.002 SOL)
        const balanceAfterAccountCreation = await connection.getBalance(botWallet.publicKey);
        const balanceAfterAccountCreationSol = balanceAfterAccountCreation / 1e9;
        
        console.log(`💰 Balance after token account creation: ${balanceAfterAccountCreationSol.toFixed(6)} SOL`);
        
        // Verify we still have enough for the trade after account creation
        if (balanceAfterAccountCreationSol < minimumRequiredForTrade) {
            throw new Error(
                `INSUFFICIENT BALANCE: After creating token account, balance is ${balanceAfterAccountCreationSol.toFixed(6)} SOL, ` +
                `but need ${minimumRequiredForTrade.toFixed(6)} SOL for trade (${actualTradeAmount.toFixed(6)} SOL) and fees. ` +
                `Please fund the bot wallet with more SOL.`
            );
        }
        
        // Build swap using Pump.fun SDK
        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const poolKey = canonicalPumpPoolPda(tokenMintPubkey);
        
        // Get swap state - this fetches the current pool state
        // Pass the token account so SDK knows it already exists
        const swapState = await onlineSdk.swapSolanaState(poolKey, botWallet.publicKey);
        
        console.log(`📊 Swap state retrieved for pool: ${poolKey.toString()}`);
        console.log(`📊 Token account: ${tokenAccount.toString()}`);
        
        // Validate the amount before passing to SDK
        if (amountBN.toNumber() !== amountLamports) {
            throw new Error(`Amount conversion error: Expected ${amountLamports} lamports, got ${amountBN.toNumber()}`);
        }
        
        console.log(`🔧 Calling Pump.fun SDK with:`);
        console.log(`   Amount: ${actualTradeAmount.toFixed(6)} SOL (${amountBN.toString()} lamports)`);
        console.log(`   Slippage: ${SLIPPAGE_BPS} bps (${(SLIPPAGE_BPS / 100).toFixed(2)}%)`);
        console.log(`   Token account: ${tokenAccount.toString()} (already exists)`);
        
        // CRITICAL: Verify amount is exactly our fixed amount (0.02 SOL)
        // This ensures we NEVER use the target's purchase amount
        const expectedLamports = Math.floor(FIXED_SOL_PER_TRADE * 1e9);
        if (amountLamports !== expectedLamports) {
            throw new Error(
                `FATAL: Amount mismatch! Expected ${expectedLamports} lamports (${FIXED_SOL_PER_TRADE} SOL), ` +
                `but got ${amountLamports} lamports. This should never happen.`
            );
        }
        
        // Verify BN amount matches
        if (!amountBN.eq(new BN(expectedLamports))) {
            throw new Error(
                `FATAL: BN amount mismatch! Expected ${expectedLamports}, got ${amountBN.toString()}`
            );
        }
        
        console.log(`🎯 VERIFIED: Using EXACTLY ${FIXED_SOL_PER_TRADE} SOL (${expectedLamports} lamports) for trade`);
        console.log(`   ✅ This is OUR fixed amount, completely independent of target's purchase`);
        console.log(`   ✅ Target's purchase amount is IGNORED - we always use ${FIXED_SOL_PER_TRADE} SOL`);
        
        // Build buy instructions using the offline SDK with the online state
        // CRITICAL: The second parameter (amountBN) MUST be our fixed amount (0.02 SOL)
        // The SDK should ONLY use this amount, not any other value
        console.log(`🔧 Calling buyQuoteInput with amount: ${amountBN.toString()} lamports (${FIXED_SOL_PER_TRADE} SOL)`);
        const buyIx = await pumpAmmSdk.buyQuoteInput(swapState, amountBN, SLIPPAGE_BPS);
        
        console.log(`📋 Generated ${buyIx.length} instructions from buyQuoteInput`);
        
        // Log instruction details for debugging
        buyIx.forEach((ix, idx) => {
            const programId = ix.programId.toString();
            const accountCount = ix.keys.length;
            console.log(`   Instruction ${idx}: Program ${programId}, ${accountCount} accounts`);
            
            // Note: We're passing exactly FIXED_SOL_PER_TRADE (0.02 SOL) to the SDK
            // If the SDK creates instructions requesting more SOL, that would be a bug in the SDK
            // The instructions are created by the SDK based on the amountBN parameter we pass
        });
        
        // Final verification
        console.log(`✅ Instructions created`);
        console.log(`   Amount passed to SDK: ${FIXED_SOL_PER_TRADE.toFixed(6)} SOL (${amountBN.toString()} lamports)`);
        console.log(`   Expected total SOL usage: ${FIXED_SOL_PER_TRADE.toFixed(6)} SOL (trade) + ~0.001 SOL (fees) = ~${(FIXED_SOL_PER_TRADE + 0.001).toFixed(6)} SOL`);
        console.log(`   Wallet balance: ${balanceAfterAccountCreationSol.toFixed(6)} SOL`);
        
        if (balanceAfterAccountCreationSol < FIXED_SOL_PER_TRADE + 0.01) {
            throw new Error(
                `INSUFFICIENT BALANCE: Need ${(FIXED_SOL_PER_TRADE + 0.01).toFixed(6)} SOL ` +
                `(${FIXED_SOL_PER_TRADE.toFixed(6)} SOL for trade + 0.01 SOL for fees), ` +
                `but only have ${balanceAfterAccountCreationSol.toFixed(6)} SOL`
            );
        }
        
        // Create transaction
        const tx = new Transaction();
        
        // Get dynamic priority fees from Helius
        const priorityFees = await getHeliusPriorityFees();
        
        // Add compute budget instructions FIRST (required for priority fees)
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFees.computeUnitPrice }));
        
        // Add buy instructions from SDK
        // These instructions should only transfer exactly amountBN lamports (0.02 SOL)
        tx.add(...buyIx);
        
        // Log transaction summary before signing
        console.log(`📦 Transaction summary:`);
        console.log(`   Total instructions: ${tx.instructions.length}`);
        console.log(`   Trade amount: ${actualTradeAmount.toFixed(6)} SOL`);
        console.log(`   Wallet balance: ${balanceAfterAccountCreationSol.toFixed(6)} SOL`);
        console.log(`   Available for trade: ${(balanceAfterAccountCreationSol - 0.001).toFixed(6)} SOL (after fees)`);
        
        // Get fresh blockhash and set fee payer
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = botWallet.publicKey;
        
        // Sign transaction
        tx.sign(botWallet);
        
        console.log('📤 Sending copy trade transaction...');
        console.log(`   Balance: ${balanceAfterAccountCreationSol.toFixed(6)} SOL`);
        console.log(`   Trade amount: ${actualTradeAmount.toFixed(6)} SOL`);
        console.log(`   Instructions: ${tx.instructions.length}`);
        
        // Send with preflight to catch errors early
        const signature = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false, // Enable preflight to catch errors
            maxRetries: 3,
            preflightCommitment: 'confirmed'
        });
        
        console.log('✅ Copy trade transaction sent:', signature);
        
        // Use Helius for faster confirmation
        await confirmTransactionWithHelius(signature);
        console.log('🎉 Copy trade completed successfully!');
        
    } catch (error) {
        console.error('❌ Copy trade failed:', error);
        
        // Handle SendTransactionError specifically
        if (error instanceof SendTransactionError) {
            console.error('📝 Transaction signature:', (error as any).signature || 'N/A');
            console.error('📝 Transaction message:', error.message);
            
            // Log transaction logs if available - use getLogs() method
            try {
                const logs = await error.getLogs(connection);
                if (logs && Array.isArray(logs)) {
                    console.error('🔎 Program logs:');
                    logs.forEach((log: string) => console.error(log));
                }
            } catch (logError) {
                console.error('⚠️ Could not retrieve transaction logs');
            }
            
            // Check for insufficient funds error
            const errorMessage = error.message || '';
            if (errorMessage.includes('insufficient lamports') || errorMessage.includes('Transfer: insufficient lamports')) {
                console.error('💸 INSUFFICIENT BALANCE ERROR DETECTED');
                console.error(`   Intended trade amount: ${FIXED_SOL_PER_TRADE.toFixed(6)} SOL (${FIXED_SOL_PER_TRADE} SOL)`);
                
                // Extract balance info from logs if available
                try {
                    const logs = await error.getLogs(connection);
                    if (logs && Array.isArray(logs)) {
                        const insufficientLog = logs.find((log: string) => 
                            log.includes('insufficient lamports') || log.includes('Transfer: insufficient lamports')
                        );
                        if (insufficientLog) {
                            console.error('   Error details:', insufficientLog);
                            
                            // Try to extract the required amount from the error
                            const needMatch = insufficientLog.match(/need (\d+)/);
                            if (needMatch) {
                                const neededLamports = parseInt(needMatch[1]);
                                const neededSol = neededLamports / 1e9;
                                const intendedLamports = Math.floor(FIXED_SOL_PER_TRADE * 1e9);
                                
                                console.error(`   Wallet balance: ${(await connection.getBalance(botWallet.publicKey)) / 1e9} SOL`);
                                console.error(`   Required by SDK: ${neededSol.toFixed(6)} SOL (${neededLamports} lamports)`);
                                console.error(`   Intended amount: ${FIXED_SOL_PER_TRADE.toFixed(6)} SOL (${intendedLamports} lamports)`);
                                
                                if (neededSol > FIXED_SOL_PER_TRADE * 2) {
                                    console.error(`   ⚠️  PROBLEM: SDK is requesting ${neededSol.toFixed(6)} SOL but we only want to trade ${FIXED_SOL_PER_TRADE.toFixed(6)} SOL!`);
                                    console.error(`   This is ${(neededSol / FIXED_SOL_PER_TRADE).toFixed(1)}x more than intended.`);
                                    console.error(`   Possible causes:`);
                                    console.error(`   1. Pump.fun SDK bug or incorrect usage`);
                                    console.error(`   2. SDK trying to create accounts that require rent`);
                                    console.error(`   3. Issue with token account setup`);
                                    console.error(`   Please check the Pump.fun SDK documentation or try updating the SDK version.`);
                                }
                            }
                        }
                    }
                } catch (logError) {
                    console.error('   Could not parse error details');
                }
                
                console.error('   SOLUTION: Ensure your wallet has enough SOL for the trade amount + fees.');
            }
        } else {
            // Handle other types of errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (errorMessage.includes('insufficient lamports') || errorMessage.includes('Insufficient balance')) {
                console.error('💸 INSUFFICIENT BALANCE: The bot wallet needs more SOL to execute trades.');
                console.error('   Please fund the bot wallet with more SOL and try again.');
            } else if (errorMessage.includes('Trade amount too small')) {
                console.error('⚠️ TRADE TOO SMALL: The available balance is too low for a meaningful trade.');
            } else {
                console.error('🔧 UNKNOWN ERROR: Please check the logs above for more details.');
            }
        }
    }
}

// Helius-enhanced transaction confirmation
async function confirmTransactionWithHelius(signature: string): Promise<void> {
    const maxAttempts = 10;
    const startTime = Date.now();
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Try Helius Enhanced Transaction API first
            const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    signatures: [signature]
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.length > 0 && data[0].confirmationStatus) {
                    const elapsed = Date.now() - startTime;
                    console.log(`🎯 Helius confirmation (${elapsed}ms): ${data[0].confirmationStatus}`);
                    return;
                }
            }
            
            // Fallback to standard RPC confirmation
            const status = await connection.getSignatureStatus(signature);
            if (status && status.value && status.value.confirmationStatus) {
                const elapsed = Date.now() - startTime;
                console.log(`🎯 Standard confirmation (${elapsed}ms): ${status.value.confirmationStatus}`);
                return;
            }
            
            console.log(`⏳ Confirmation attempt ${attempt}/${maxAttempts}...`);
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.log(`⚠️ Confirmation error (attempt ${attempt}):`, error);
            if (attempt === maxAttempts) {
                throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
}

// Get optimized priority fees from Helius
async function getHeliusPriorityFees(): Promise<{ computeUnitPrice: number }> {
    try {
        // Use Helius RPC method for recent prioritization fees
        const recentFees = await connection.getRecentPrioritizationFees({
            lockedWritableAccounts: [botWallet.publicKey]
        });

        if (!recentFees || recentFees.length === 0) {
            console.log('⚠️ No recent prioritization fees found, using default');
            return { computeUnitPrice: COMPUTE_UNIT_PRICE };
        }

        // Calculate median fee per CU
        const feesPerCu = recentFees.map(fee => {
            const cuLimit = (fee as any).computeUnitLimit || COMPUTE_UNIT_LIMIT;
            return fee.prioritizationFee / cuLimit;
        });
        feesPerCu.sort((a, b) => a - b);
        
        const medianFeePerCu = feesPerCu[Math.floor(feesPerCu.length / 2)];
        
        // Add 10% above median for competitive pricing
        const competitiveMultiplier = 1.1;
        const dynamicComputeUnitPrice = Math.max(
            Math.floor(medianFeePerCu * competitiveMultiplier),
            COMPUTE_UNIT_PRICE // Never go below minimum
        );

        console.log(`📊 Helius Priority Fee: Median=${medianFeePerCu.toFixed(0)}, CU Price=${dynamicComputeUnitPrice}, Multiplier=${competitiveMultiplier.toFixed(2)}x`);
        
        return { computeUnitPrice: dynamicComputeUnitPrice };
        
    } catch (error) {
        console.log('⚠️ Failed to get Helius priority fees, using default:', error);
        return { computeUnitPrice: COMPUTE_UNIT_PRICE };
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
