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

// Load environment variables
dotenv.config();

// Constants
const PUMP_FUN_PROGRAM_ID = 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 200;

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Environment validation
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS;
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET;
const FIXED_BUY_AMOUNT = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.08');
const SLIPPAGE_PERCENT = parseFloat(process.env.SLIPPAGE_PERCENT || '25');

if (!TARGET_WALLET_ADDRESS) {
    console.error('❌ TARGET_WALLET_ADDRESS environment variable is required');
    process.exit(1);
}

if (!BOT_WALLET_SECRET) {
    console.error('❌ BOT_WALLET_SECRET environment variable is required');
    process.exit(1);
}

// Initialize Solana connection and wallet
const connection = new Connection(RPC_URL, 'confirmed');
const botWallet = Keypair.fromSecretKey(bs58.decode(BOT_WALLET_SECRET));
const pumpAmmSdk = new PumpAmmSdk();

console.log('🚀 Bot initialized');
console.log('🤖 Bot wallet:', botWallet.publicKey.toString());
console.log('🎯 Target wallet:', TARGET_WALLET_ADDRESS);
console.log('💰 Fixed buy amount:', FIXED_BUY_AMOUNT, 'SOL');
console.log('📡 RPC URL:', RPC_URL);

/**
 * Main webhook endpoint
 */
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

/**
 * Process webhook data asynchronously
 */
async function processWebhookAsync(webhookData: any) {
    try {
        // Handle array of transactions
        const transaction = Array.isArray(webhookData) ? webhookData[0] : webhookData;
        
        if (!transaction) {
            console.log('⚠️  No transaction data found');
            return;
        }

        // Step 1: Check if target wallet is involved
        if (!isTargetWalletInvolved(transaction)) {
            console.log('❌ Target wallet not involved - skipping');
            return;
        }

        console.log('✅ Target wallet involved - analyzing transaction...');

        // Step 2: Check if this is a Pump.fun transaction
        if (!isPumpFunTransaction(transaction)) {
            console.log('❌ Not a Pump.fun transaction - skipping');
            return;
        }

        console.log('✅ Pump.fun transaction detected');

        // Debug: Log transaction details
        const tokenTransfers = transaction.tokenTransfers || [];
        const nativeTransfers = transaction.nativeTransfers || [];
        console.log(`   Token transfers: ${tokenTransfers.length}`);
        console.log(`   Native transfers: ${nativeTransfers.length}`);
        
        if (tokenTransfers.length > 0) {
            console.log('   Token transfer details:');
            tokenTransfers.forEach((transfer: any, idx: number) => {
                console.log(`     [${idx}] ${transfer.fromUserAccount?.substring(0, 8)}... -> ${transfer.toUserAccount?.substring(0, 8)}... | Mint: ${transfer.mint?.substring(0, 8)}... | Amount: ${transfer.tokenAmount}`);
            });
        }

        // Step 3: Detect buy transaction and extract token mint
        const buyInfo = detectBuyTransaction(transaction);
        
        if (!buyInfo.isBuy) {
            console.log('❌ Not a buy transaction - skipping');
            return;
        }

        // Step 4: Validate token mint (must not be SOL/WSOL)
        if (!buyInfo.tokenMint || buyInfo.tokenMint === WSOL_MINT) {
            console.log('❌ Invalid token mint detected - cannot be SOL/WSOL');
            console.log(`   Detected mint: ${buyInfo.tokenMint}`);
            return;
        }

        // Validate token mint format (should be a valid Solana public key)
        try {
            new PublicKey(buyInfo.tokenMint);
        } catch (error) {
            console.log(`❌ Invalid token mint format: ${buyInfo.tokenMint}`);
            return;
        }

        console.log('🟢 BUY TRANSACTION DETECTED!');
        console.log(`   Token: ${buyInfo.tokenMint}`);
        console.log(`   Target spent: ${buyInfo.solAmount} SOL`);
        console.log(`   Bot will buy: ${FIXED_BUY_AMOUNT} SOL`);

        // Step 5: Execute buy
        await executePumpFunBuy(buyInfo.tokenMint, FIXED_BUY_AMOUNT);

    } catch (error: any) {
        console.error('❌ Error processing webhook:', error);
        if (error.message) {
            console.error('   Error message:', error.message);
        }
        if (error.stack) {
            console.error('   Stack:', error.stack);
        }
    }
}

/**
 * Check if target wallet is involved in the transaction
 */
function isTargetWalletInvolved(transaction: any): boolean {
    const targetWallet = TARGET_WALLET_ADDRESS;
    
    // Check account data
    const accountData = transaction.accountData || [];
    const hasTargetInAccounts = accountData.some((account: any) => 
        account.account === targetWallet
    );

    if (hasTargetInAccounts) {
        return true;
    }

    // Check token transfers
    const tokenTransfers = transaction.tokenTransfers || [];
    const hasTargetInTokenTransfers = tokenTransfers.some((transfer: any) =>
        transfer.fromUserAccount === targetWallet ||
        transfer.toUserAccount === targetWallet
    );

    // Check native transfers
    const nativeTransfers = transaction.nativeTransfers || [];
    const hasTargetInNativeTransfers = nativeTransfers.some((transfer: any) =>
        transfer.fromUserAccount === targetWallet ||
        transfer.toUserAccount === targetWallet
    );

    return hasTargetInTokenTransfers || hasTargetInNativeTransfers;
}

/**
 * Check if transaction involves Pump.fun program
 */
function isPumpFunTransaction(transaction: any): boolean {
    // Check transaction source
    if (transaction.source === 'PUMP_AMM') {
        return true;
    }

    // Check instructions for Pump.fun program ID
    const instructions = transaction.instructions || [];
    const innerInstructions = transaction.innerInstructions || [];
    const allInstructions = [...instructions, ...innerInstructions.flat()];

    const hasPumpFunProgram = allInstructions.some((ix: any) => {
        const programId = ix.programId || ix.programIdIndex;
        if (typeof programId === 'string') {
            return programId === PUMP_FUN_PROGRAM_ID;
        }
        // If programIdIndex, check accountData
        if (typeof programId === 'number' && transaction.accountData) {
            const account = transaction.accountData[programId];
            return account?.account === PUMP_FUN_PROGRAM_ID;
        }
        return false;
    });

    if (hasPumpFunProgram) {
        return true;
    }

    // Check account data for Pump.fun program ID
    const accountData = transaction.accountData || [];
    const hasPumpFunAccount = accountData.some((account: any) =>
        account.account === PUMP_FUN_PROGRAM_ID
    );

    return hasPumpFunAccount;
}

/**
 * Helper function to compare wallet addresses (case-insensitive)
 */
function addressesMatch(addr1: string | undefined, addr2: string | undefined): boolean {
    if (!addr1 || !addr2) return false;
    return addr1.toLowerCase() === addr2.toLowerCase();
}

/**
 * Detect buy transaction and extract token mint
 */
function detectBuyTransaction(transaction: any): {
    isBuy: boolean;
    tokenMint: string;
    solAmount: number;
} {
    const targetWallet = TARGET_WALLET_ADDRESS?.toLowerCase();

    // Get token transfers
    const tokenTransfers = transaction.tokenTransfers || [];
    
    // Get native transfers (SOL)
    const nativeTransfers = transaction.nativeTransfers || [];

    console.log(`   DEBUG: Target wallet: ${targetWallet}`);
    console.log(`   DEBUG: Checking ${tokenTransfers.length} token transfers...`);

    // Use arrays we can modify
    let targetReceivingTokens: any[] = [];
    let targetSendingWSOL: any[] = [];

    // First pass: try standard field names
    tokenTransfers.forEach((transfer: any) => {
        const toAccount = transfer.toUserAccount?.toLowerCase();
        const fromAccount = transfer.fromUserAccount?.toLowerCase();
        const mint = transfer.mint;
        
        // Check if target is receiving non-WSOL tokens
        if (addressesMatch(toAccount, targetWallet) && mint && mint !== WSOL_MINT) {
            console.log(`   DEBUG: Found token received: ${mint} -> ${toAccount}`);
            targetReceivingTokens.push(transfer);
        }
        
        // Check if target is sending WSOL
        const tokenAmount = transfer.tokenAmount || transfer.amount || transfer.uiAmount || '0';
        const amount = parseFloat(tokenAmount);
        if (addressesMatch(fromAccount, targetWallet) &&
            (mint === WSOL_MINT || mint?.startsWith('So11111111111111111111111111111111111111112')) &&
            amount > 0) {
            console.log(`   DEBUG: Found WSOL sent: ${amount} from ${fromAccount}`);
            targetSendingWSOL.push(transfer);
        }
    });

    // Also check native SOL transfers (some transactions might use native SOL)
    const targetSendingSol = nativeTransfers.filter((transfer: any) => {
        const fromAccount = transfer.fromUserAccount?.toLowerCase();
        const matches = addressesMatch(fromAccount, targetWallet) && transfer.amount > 0;
        
        if (matches) {
            console.log(`   DEBUG: Found native SOL sent: ${transfer.amount} from ${fromAccount}`);
        }
        
        return matches;
    });

    console.log(`   DEBUG: Target receiving tokens: ${targetReceivingTokens.length}`);
    console.log(`   DEBUG: Target sending WSOL: ${targetSendingWSOL.length}`);
    console.log(`   DEBUG: Target sending native SOL: ${targetSendingSol.length}`);

    // If we didn't find matches with standard field names, try alternative field names
    if (targetReceivingTokens.length === 0 && tokenTransfers.length > 0) {
        console.log('   DEBUG: Trying alternative field names for token transfers...');
        tokenTransfers.forEach((transfer: any, idx: number) => {
            const toAccount = (transfer.toUserAccount || transfer.to || transfer.toAccount || transfer.recipient || transfer.toTokenAccount)?.toLowerCase();
            const fromAccount = (transfer.fromUserAccount || transfer.from || transfer.fromAccount || transfer.sender || transfer.fromTokenAccount)?.toLowerCase();
            const mint = transfer.mint || transfer.tokenMint;
            
            console.log(`     Transfer [${idx}]:`);
            console.log(`       From: ${fromAccount}`);
            console.log(`       To: ${toAccount}`);
            console.log(`       Mint: ${mint}`);
            console.log(`       Amount: ${transfer.tokenAmount || transfer.amount || transfer.uiAmount}`);
            
            // Check if target is receiving non-WSOL tokens (only if we haven't found it yet)
            if (addressesMatch(toAccount, targetWallet) && mint && mint !== WSOL_MINT) {
                const alreadyFound = targetReceivingTokens.some(t => t === transfer);
                if (!alreadyFound) {
                    console.log(`       ✅ MATCH: Target receiving token ${mint}`);
                    targetReceivingTokens.push(transfer);
                }
            }
            
            // Check if target is sending WSOL (only if we haven't found it yet)
            if (addressesMatch(fromAccount, targetWallet) && 
                (mint === WSOL_MINT || mint?.startsWith('So11111111111111111111111111111111111111112'))) {
                const amount = parseFloat(transfer.tokenAmount || transfer.amount || transfer.uiAmount || '0');
                if (amount > 0) {
                    const alreadyFound = targetSendingWSOL.some(t => t === transfer);
                    if (!alreadyFound) {
                        console.log(`       ✅ MATCH: Target sending WSOL ${amount}`);
                        targetSendingWSOL.push(transfer);
                    }
                }
            }
        });
    }

    // For a Pump.fun buy: target should send WSOL/SOL and receive tokens
    if (targetReceivingTokens.length > 0 && (targetSendingWSOL.length > 0 || targetSendingSol.length > 0)) {
        // Get the first valid token mint (not WSOL)
        const validTokenTransfer = targetReceivingTokens.find((transfer: any) =>
            transfer.mint && transfer.mint !== WSOL_MINT
        );

        if (validTokenTransfer) {
            // Calculate total SOL/WSOL sent
            let totalSolSent = 0;
            
            // Sum WSOL sent (convert from token amount)
            if (targetSendingWSOL.length > 0) {
                totalSolSent = targetSendingWSOL.reduce((sum: number, transfer: any) => {
                    // Try multiple field names for amount
                    const tokenAmount = transfer.tokenAmount || transfer.amount || transfer.uiAmount || '0';
                    const amount = parseFloat(tokenAmount);
                    // WSOL uses 9 decimals like SOL, but check if already in SOL units
                    // If amount is less than 1000, it's likely already in SOL units
                    return sum + (amount < 1000 ? amount : amount / 1e9);
                }, 0);
            }
            
            // Add native SOL sent
            if (targetSendingSol.length > 0) {
                totalSolSent += targetSendingSol.reduce((sum: number, transfer: any) => 
                    sum + transfer.amount, 0
                ) / 1e9; // Convert lamports to SOL
            }

            console.log(`   Detected buy: ${validTokenTransfer.mint}`);
            console.log(`   SOL/WSOL spent: ${totalSolSent} SOL`);

            return {
                isBuy: true,
                tokenMint: validTokenTransfer.mint,
                solAmount: totalSolSent
            };
        }
    }

    // Alternative: Check pre/post token balances (more reliable for some webhook formats)
    const preTokenBalances = transaction.preTokenBalances || [];
    const postTokenBalances = transaction.postTokenBalances || [];
    
    if (preTokenBalances.length > 0 && postTokenBalances.length > 0) {
        // Find accounts where target wallet gained tokens
        const targetAccountIndices = new Set<number>();
        const accountData = transaction.accountData || [];
        
        accountData.forEach((account: any, index: number) => {
            if (account.account === targetWallet) {
                targetAccountIndices.add(index);
            }
        });

        // Check token balance changes
        for (const postBalance of postTokenBalances) {
            if (targetAccountIndices.has(postBalance.accountIndex)) {
                const preBalance = preTokenBalances.find((pre: any) =>
                    pre.accountIndex === postBalance.accountIndex &&
                    pre.mint === postBalance.mint
                );

                if (preBalance) {
                    const preAmount = parseFloat(preBalance.uiTokenAmount?.amount || '0');
                    const postAmount = parseFloat(postBalance.uiTokenAmount?.amount || '0');
                    
                    // Target gained tokens and it's not WSOL
                    if (postAmount > preAmount && postBalance.mint !== WSOL_MINT) {
                        // Calculate SOL/WSOL spent
                        let totalSolSent = 0;
                        
                        // Check WSOL transfers
                        if (targetSendingWSOL.length > 0) {
                            totalSolSent = targetSendingWSOL.reduce((sum: number, transfer: any) => {
                                const amount = parseFloat(transfer.tokenAmount || '0');
                                return sum + (amount / 1e9);
                            }, 0);
                        }
                        
                        // Check native SOL transfers
                        if (targetSendingSol.length > 0) {
                            totalSolSent += targetSendingSol.reduce((sum: number, transfer: any) => 
                                sum + transfer.amount, 0) / 1e9;
                        }

                        console.log(`   Detected buy from balances: ${postBalance.mint}`);
                        console.log(`   SOL/WSOL spent: ${totalSolSent} SOL`);

                        return {
                            isBuy: true,
                            tokenMint: postBalance.mint,
                            solAmount: totalSolSent
                        };
                    }
                } else {
                    // New token balance (didn't exist before)
                    if (postBalance.mint !== WSOL_MINT) {
                        const postAmount = parseFloat(postBalance.uiTokenAmount?.uiAmountString || postBalance.uiTokenAmount?.amount || '0');
                        
                        if (postAmount > 0) {
                            // Calculate SOL/WSOL spent
                            let totalSolSent = 0;
                            
                            if (targetSendingWSOL.length > 0) {
                                totalSolSent = targetSendingWSOL.reduce((sum: number, transfer: any) => {
                                    const amount = parseFloat(transfer.tokenAmount || '0');
                                    return sum + (amount / 1e9);
                                }, 0);
                            }
                            
                            if (targetSendingSol.length > 0) {
                                totalSolSent += targetSendingSol.reduce((sum: number, transfer: any) => 
                                    sum + transfer.amount, 0) / 1e9;
                            }

                            console.log(`   Detected new token buy: ${postBalance.mint}`);
                            console.log(`   SOL/WSOL spent: ${totalSolSent} SOL`);

                            return {
                                isBuy: true,
                                tokenMint: postBalance.mint,
                                solAmount: totalSolSent
                            };
                        }
                    }
                }
            }
        }
    }

    return {
        isBuy: false,
        tokenMint: '',
        solAmount: 0
    };
}

/**
 * Execute Pump.fun buy transaction
 */
async function executePumpFunBuy(tokenMint: string, amountSol: number, retryCount: number = 0): Promise<void> {
    try {
        console.log(`🚀 Executing Pump.fun buy`);
        console.log(`   Token mint: ${tokenMint}`);
        console.log(`   Amount: ${amountSol} SOL`);
        console.log(`   Bot wallet: ${botWallet.publicKey.toString()}`);

        // Validate token mint
        if (!tokenMint || tokenMint === WSOL_MINT) {
            throw new Error('Invalid token mint - cannot trade SOL on Pump.fun');
        }

        // Convert SOL to lamports
        const amountLamports = new BN(Math.floor(amountSol * 1e9));
        const tokenMintPubkey = new PublicKey(tokenMint);

        // Initialize online SDK
        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const poolKey = canonicalPumpPoolPda(tokenMintPubkey);

        console.log(`   Pool key: ${poolKey.toString()}`);

        // Add delay on retries
        if (retryCount > 0) {
            console.log(`🔄 Retry attempt ${retryCount}/${MAX_RETRIES}...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * retryCount));
        }

        // Get swap state
        let swapState;
        try {
            swapState = await onlineSdk.swapSolanaState(poolKey, botWallet.publicKey);
        } catch (error: any) {
            const errorMsg = error?.message || String(error);
            
            // Check if pool doesn't exist
            if (errorMsg.includes('Pool account not found') ||
                errorMsg.includes('AccountNotFound') ||
                errorMsg.includes('not found')) {
                console.error(`❌ Pool account not found for token ${tokenMint}`);
                console.error(`   This token may not be a Pump.fun token or the pool hasn't been created yet`);
                return; // Don't retry - pool doesn't exist
            }
            
            // Retry on other errors
            if (retryCount < MAX_RETRIES) {
                console.log(`⚠️  Error getting swap state, retrying...`);
                return executePumpFunBuy(tokenMint, amountSol, retryCount + 1);
            }
            
            throw error;
        }

        // Build buy instruction
        const buyIx = await pumpAmmSdk.buyQuoteInput(swapState, amountLamports, SLIPPAGE_PERCENT);

        // Create transaction
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction();
        tx.add(...buyIx);
        tx.recentBlockhash = blockhash;
        tx.feePayer = botWallet.publicKey;
        tx.sign(botWallet);

        console.log('📤 Sending transaction...');

        // Send transaction
        let signature: string;
        try {
            signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 3
            });
        } catch (sendError: any) {
            console.log('⚠️  First send attempt failed, trying with preflight...');
            signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3
            });
        }

        console.log(`✅ Transaction sent: ${signature}`);
        console.log(`   Explorer: https://solscan.io/tx/${signature}`);

        // Confirm transaction
        try {
            await connection.confirmTransaction(
                { signature, blockhash, lastValidBlockHeight },
                'confirmed'
            );
            console.log('🎉 Transaction confirmed!');
        } catch (confirmError: any) {
            const confirmMsg = confirmError?.message || String(confirmError);
            if (confirmMsg.includes('TransactionExpiredTimeoutError') ||
                confirmMsg.includes('not confirmed')) {
                console.warn('⚠️  Transaction confirmation timed out, but it may have succeeded');
                console.warn(`   Check on explorer: https://solscan.io/tx/${signature}`);
            } else {
                throw confirmError;
            }
        }

    } catch (error: any) {
        const errorMsg = error?.message || String(error);
        
        // Check for retryable errors
        const isRetryable = 
            errorMsg.includes('pool') ||
            errorMsg.includes('not ready') ||
            errorMsg.includes('ConstraintMut') ||
            errorMsg.includes('0x7d0');

        if (isRetryable && retryCount < MAX_RETRIES) {
            console.log(`🔄 Retryable error detected, retrying...`);
            return executePumpFunBuy(tokenMint, amountSol, retryCount + 1);
        }

        console.error('❌ Pump.fun buy failed:', errorMsg);
        if (error.stack) {
            console.error('   Stack:', error.stack);
        }
        throw error;
    }
}

/**
 * Health check endpoint
 */
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

/**
 * Error handling middleware
 */
app.use((error: any, req: Request, res: Response, next: any) => {
    console.error('❌ Server error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

/**
 * Start server
 */
app.listen(PORT, () => {
    console.log(`\n🚀 Pump.fun Copy Trading Bot`);
    console.log(`📡 Webhook endpoint: POST /webhook`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`🌐 Server running on port ${PORT}\n`);
});

export default app;
