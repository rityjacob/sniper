import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { dexManager } from './dex';
import { PumpFunWebhook } from './types';
import { logger } from './utils/logger';
import { config } from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Handle large webhook payloads
app.use(express.urlencoded({ extended: true }));

// Validate target wallet address is set
if (!process.env.TARGET_WALLET_ADDRESS) {
  logger.logError('system', 'TARGET_WALLET_ADDRESS environment variable is not set');
  process.exit(1);
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'Pump.fun Sniper Bot',
        targetWallet: process.env.TARGET_WALLET_ADDRESS ? 'Set' : 'Not Set'
    });
});

// Test endpoint to verify webhook server is working
app.post('/test-webhook', (req: Request, res: Response) => {
    console.log('🧪 TEST WEBHOOK RECEIVED');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('📋 Body:', JSON.stringify(req.body, null, 2));
    
    res.status(200).json({
        success: true,
        message: 'Test webhook received successfully',
        timestamp: new Date().toISOString(),
        receivedData: req.body
    });
});

// Simple GET endpoint to test basic connectivity
app.get('/test', (req: Request, res: Response) => {
    console.log('🧪 TEST GET REQUEST RECEIVED');
    console.log('📅 Timestamp:', new Date().toISOString());
    
    res.status(200).json({
        success: true,
        message: 'Server is reachable!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        targetWallet: process.env.TARGET_WALLET_ADDRESS ? 'Set' : 'Not Set',
        fixedBuyAmount: process.env.FIXED_BUY_AMOUNT || 'Not Set'
    });
});

// Main webhook endpoint for Helius enhanced webhooks
app.post('/webhook', async (req: Request, res: Response) => {
    console.log('\n🔔 === WEBHOOK RECEIVED ===');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('📋 Event Type:', req.body.type || 'Unknown');
    console.log('🔍 Signature:', req.body.signature || 'N/A');
    console.log('📊 Payload Size:', JSON.stringify(req.body).length, 'characters');
    console.log('🎯 Target Wallet:', process.env.TARGET_WALLET_ADDRESS || 'NOT SET');
    console.log('💰 Fixed Buy Amount:', process.env.FIXED_BUY_AMOUNT || 'NOT SET');
    
    // Enhanced debugging for webhook structure
    console.log('\n🔍 WEBHOOK STRUCTURE ANALYSIS:');
    console.log('  - Has tokenTransfers:', !!req.body.tokenTransfers);
    console.log('  - Has nativeTransfers:', !!req.body.nativeTransfers);
    console.log('  - Has instructions:', !!req.body.instructions);
    console.log('  - Has accountData:', !!req.body.accountData);
    console.log('  - Has feePayer:', !!req.body.feePayer);
    
    // Format the payload in a readable way
    if (req.body.tokenTransfers && req.body.tokenTransfers.length > 0) {
        console.log('\n📦 TOKEN TRANSFERS:');
        req.body.tokenTransfers.forEach((transfer: any, index: number) => {
            console.log(`  ${index + 1}. ${transfer.mint || 'Unknown Token'}`);
            console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
            console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
            console.log(`     Amount: ${transfer.tokenAmount || 'N/A'}`);
            console.log(`     Token Account From: ${transfer.fromTokenAccount || 'N/A'}`);
            console.log(`     Token Account To: ${transfer.toTokenAccount || 'N/A'}`);
            console.log('');
        });
    } else {
        console.log('\n📦 TOKEN TRANSFERS: None found');
    }
    
    if (req.body.nativeTransfers && req.body.nativeTransfers.length > 0) {
        console.log('💰 NATIVE TRANSFERS (SOL):');
        req.body.nativeTransfers.forEach((transfer: any, index: number) => {
            const amountInSol = transfer.amount ? (transfer.amount / 1e9).toFixed(6) : 'N/A';
            console.log(`  ${index + 1}. ${amountInSol} SOL`);
            console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
            console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
            console.log(`     Amount (lamports): ${transfer.amount || 'N/A'}`);
            console.log('');
        });
    } else {
        console.log('💰 NATIVE TRANSFERS (SOL): None found');
    }
    
    // Check if target wallet is involved
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    if (targetWallet) {
        const isTargetInvolved = req.body.tokenTransfers?.some((t: any) => 
            t.fromUserAccount === targetWallet || t.toUserAccount === targetWallet
        ) || req.body.nativeTransfers?.some((t: any) => 
            t.fromUserAccount === targetWallet || t.toUserAccount === targetWallet
        );
        
        console.log(`🎯 TARGET WALLET INVOLVED: ${isTargetInvolved ? 'YES' : 'NO'}`);
        if (isTargetInvolved) {
            console.log(`   Target Wallet: ${targetWallet}`);
            console.log(`   Looking for: ${targetWallet}`);
        } else {
            console.log(`   Target Wallet: ${targetWallet}`);
            console.log(`   ❌ Target wallet not found in this transaction`);
        }
    } else {
        console.log('❌ TARGET_WALLET_ADDRESS not configured');
    }
    
    console.log('=== END WEBHOOK ===\n');

    try {
        logger.logInfo('webhook', 'Received Helius webhook', 'Processing enhanced webhook data');

        // Log the actual webhook data for debugging
        logger.logInfo('webhook', 'Webhook payload', JSON.stringify(req.body));

        // Handle both array and single transaction formats
        let transactions = [];
        if (Array.isArray(req.body)) {
            transactions = req.body;
        } else if (req.body) {
            // Single transaction object
            transactions = [req.body];
        } else {
            logger.logWarning('webhook', 'Invalid webhook format', 'No transaction data received');
            return res.status(200).json({ 
                success: false,
                message: 'Invalid webhook format - no transaction data received',
                timestamp: new Date().toISOString()
            });
        }

        logger.logInfo('webhook', 'Processing transactions', `Received ${transactions.length} transaction(s)`);

        let processedCount = 0;
        let pumpFunCount = 0;

        for (const tx of transactions) {
            try {
                // Log ALL transactions for debugging
                logger.logInfo('webhook', 'Transaction received', 
                    `Type: ${tx.type || 'unknown'}, Program: ${tx.programId || 'unknown'}, Signature: ${tx.signature?.slice(0, 8) || 'unknown'}...`
                );
                
                // Check if this is a Pump.fun transaction
                const isPumpFun = tx.programId === 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61' || 
                                 tx.source === 'PUMP_AMM' ||
                                 (tx.instructions && tx.instructions.some((inst: any) => 
                                     inst.programId === 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61'
                                 )) ||
                                 (tx.instructions && tx.instructions.some((inst: any) => 
                                     inst.innerInstructions && inst.innerInstructions.some((innerInst: any) => 
                                         innerInst.programId === 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61'
                                     )
                                 ));
                
                // Log transaction details for debugging
                logger.logInfo('webhook', 'Transaction analysis', 
                    `Type: ${tx.type}, Program: ${tx.programId}, IsPumpFun: ${isPumpFun}, TokenTransfers: ${tx.tokenTransfers?.length || 0}, NativeTransfers: ${tx.nativeTransfers?.length || 0}`
                );
                
                // Handle Pump.fun specific logic
                if (tx.type === 'SWAP' && isPumpFun) {
                    pumpFunCount++;
                    
                    logger.logInfo('webhook', 'Pump.fun SWAP detected', 
                        `Token: ${tx.tokenTransfers?.[0]?.mint || 'unknown'}, Amount: ${tx.nativeTransfers?.[0]?.amount || 'unknown'}`
                    );

                    // DEBUG: Log the actual webhook data structure
                    logger.logInfo('webhook', 'DEBUG: Webhook data structure', 
                        `ProgramId: ${tx.programId}, Source: ${tx.source}, Instructions: ${tx.instructions?.length || 0}`
                    );
                    
                    if (tx.instructions && tx.instructions.length > 0) {
                        tx.instructions.forEach((inst: any, index: number) => {
                            logger.logInfo('webhook', `DEBUG: Instruction ${index}`, 
                                `ProgramId: ${inst.programId}, InnerInstructions: ${inst.innerInstructions?.length || 0}`
                            );
                            if (inst.innerInstructions) {
                                inst.innerInstructions.forEach((innerInst: any, innerIndex: number) => {
                                    logger.logInfo('webhook', `DEBUG: Inner Instruction ${index}.${innerIndex}`, 
                                        `ProgramId: ${innerInst.programId}`
                                    );
                                });
                            }
                        });
                    }

                    // Analyze the transaction to determine if it's a buy or sell
                    const tokenTransfers = tx.tokenTransfers || [];
                    const nativeTransfers = tx.nativeTransfers || [];
                    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
                    
                    // DEBUG: Log target wallet and transaction signer
                    logger.logInfo('webhook', 'DEBUG: Wallet comparison', 
                        `TargetWallet: ${targetWallet}, TransactionSigner: ${tx.feePayer || 'unknown'}`
                    );
                    
                    // DEBUG: Log token transfers
                    logger.logInfo('webhook', 'DEBUG: Token transfers', 
                        `Count: ${tokenTransfers.length}, TargetWallet: ${targetWallet}`
                    );
                    tokenTransfers.forEach((transfer: any, index: number) => {
                        logger.logInfo('webhook', `DEBUG: Token transfer ${index}`, 
                            `Mint: ${transfer.mint}, From: ${transfer.fromUserAccount}, To: ${transfer.toUserAccount}`
                        );
                    });
                    
                    // Find if target wallet is buying (receiving tokens) or selling (sending tokens)
                    const targetBuying = tokenTransfers.some((transfer: any) => 
                        transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet
                    );
                    
                    const targetSelling = tokenTransfers.some((transfer: any) => 
                        transfer.fromUserAccount === targetWallet || transfer.fromTokenAccount === targetWallet
                    );
                    
                    logger.logInfo('webhook', 'DEBUG: Transaction direction', 
                        `TargetBuying: ${targetBuying}, TargetSelling: ${targetSelling}`
                    );
                    
                    // Determine input and output mints based on transaction direction
                    let inputMint, outputMint;
                    if (targetBuying) {
                        // Target is buying: SOL → Token
                        inputMint = 'So11111111111111111111111111111111111111112'; // WSOL
                        outputMint = tokenTransfers.find((t: any) => 
                            t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
                        )?.mint || '';
                    } else if (targetSelling) {
                        // Target is selling: Token → SOL
                        inputMint = tokenTransfers.find((t: any) => 
                            t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
                        )?.mint || '';
                        outputMint = 'So11111111111111111111111111111111111111112'; // WSOL
                    } else {
                        // Fallback to original logic
                        inputMint = 'So11111111111111111111111111111111111111112';
                        outputMint = tx.tokenTransfers?.[0]?.mint || '';
                    }

                    logger.logInfo('webhook', 'DEBUG: Determined mints', 
                        `InputMint: ${inputMint}, OutputMint: ${outputMint}`
                    );

                    // Extract transaction details
                    const webhookData = {
                        inputMint: inputMint,
                        outputMint: outputMint,
                        amount: tx.nativeTransfers?.[0]?.amount || '0',
                        programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61', // Always set to Pump.fun program ID for Pump.fun transactions
                        signature: tx.signature,
                        slot: tx.slot,
                        blockTime: tx.timestamp,
                        accounts: tx.accountData?.map((acc: any) => acc.account) || [],
                        data: tx.instructions?.[0]?.data || '',
                        transaction: tx // Include full transaction data for enhanced processing
                    };

                    logger.logInfo('webhook', 'DEBUG: Webhook data constructed', 
                        `ProgramId: ${webhookData.programId}, InputMint: ${webhookData.inputMint}, OutputMint: ${webhookData.outputMint}`
                    );

                    // Only process if target wallet is buying (we want to copy buys, not sells)
                    if (targetBuying) {
                        // Extract fixed buy amount from environment or use default
                        const fixedBuyAmount = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.1');
                        
                        logger.logInfo('webhook', 'Executing Pump.fun trade', 
                            `Fixed buy amount: ${fixedBuyAmount} SOL, Token: ${webhookData.outputMint}`
                        );

                        // Process the webhook and execute trade
                        const signature = await dexManager.processLeaderBuyWebhook(webhookData, fixedBuyAmount);
                        
                        logger.logInfo('webhook', 'Pump.fun trade completed', 
                            `Signature: ${signature}, Token: ${webhookData.outputMint}`
                        );
                    } else {
                        logger.logInfo('webhook', 'Skipping sell transaction', 
                            `Target wallet is selling, not buying. Token: ${webhookData.inputMint}`
                        );
                    }
                } else {
                    // Handle general SWAP and TRANSFER events for target wallet tracking
                    if (tx.type === 'SWAP' || tx.type === 'TRANSFER') {
                        await handleEvent(tx);
                    } else {
                        logger.logInfo('webhook', 'Non-Pump.fun transaction', 
                            `Type: ${tx.type}, Program: ${tx.programId}, Description: ${tx.description || 'N/A'}`
                        );
                    }
                }
                
                processedCount++;
            } catch (error: any) {
                logger.logError('webhook', 'Transaction processing failed', error.message);
            }
        }

        // Return success response
        res.status(200).json({
            success: true,
            message: `Processed ${processedCount} transaction(s), ${pumpFunCount} Pump.fun SWAP(s)`,
            timestamp: new Date().toISOString(),
            summary: {
                totalTransactions: transactions.length,
                processedTransactions: processedCount,
                pumpFunSwaps: pumpFunCount
            }
        });

    } catch (error: any) {
        logger.logError('webhook', 'Webhook processing failed', error.message);
        
        // Return error response
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

async function handleEvent(data: any) {
    logger.logInfo('webhook', 'Processing event', JSON.stringify(data));
    
    // Handle both SWAP and TRANSFER events
    if (data.type === 'SWAP') {
        await handleSwap(data);
    } else if (data.type === 'TRANSFER') {
        await handleTransfer(data);
    } else {
        logger.logInfo('webhook', `Ignoring event type: ${data.type}`);
    }
}

async function handleSwap(data: any) {
    try {
        const tokenTransfers = data.tokenTransfers || [];
        const nativeTransfers = data.nativeTransfers || [];
        const targetWallet = process.env.TARGET_WALLET_ADDRESS;

        console.log('\n🔄 === PROCESSING SWAP EVENT ===');
        console.log('🎯 Target Wallet:', targetWallet);
        console.log('📊 Token Transfers Count:', tokenTransfers.length);
        console.log('💰 Native Transfers Count:', nativeTransfers.length);

        logger.logInfo('swap', 'Processing swap event', `Target wallet: ${targetWallet}`);

        // Find the token being bought (token that was transferred TO the target wallet)
        const buyTransfer = tokenTransfers.find((transfer: any) => {
            const isTargetReceiver = transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
            console.log(`🔍 Checking transfer: ${transfer.mint || 'Unknown'}`);
            console.log(`   To User Account: ${transfer.toUserAccount}`);
            console.log(`   To Token Account: ${transfer.toTokenAccount}`);
            console.log(`   Target Wallet: ${targetWallet}`);
            console.log(`   Is Target Receiver: ${isTargetReceiver}`);
            return isTargetReceiver;
        });

        console.log('📦 Buy Transfer Found:', !!buyTransfer);
        if (buyTransfer) {
            console.log('   Token Mint:', buyTransfer.mint);
            console.log('   Token Amount:', buyTransfer.tokenAmount);
            console.log('   To User Account:', buyTransfer.toUserAccount);
            console.log('   To Token Account:', buyTransfer.toTokenAccount);
        }

        // Get the SOL amount spent
        const solTransfersFromTarget = nativeTransfers.filter((transfer: any) => transfer.fromUserAccount === targetWallet);
        console.log('💸 SOL Transfers FROM Target:', solTransfersFromTarget.length);
        solTransfersFromTarget.forEach((transfer: any, index: number) => {
            console.log(`   ${index + 1}. Amount: ${(transfer.amount / 1e9).toFixed(6)} SOL (${transfer.amount} lamports)`);
            console.log(`      To: ${transfer.toUserAccount}`);
        });

        const totalSolSpent = solTransfersFromTarget.reduce((sum: number, transfer: any) => sum + transfer.amount, 0);
        console.log('💸 Total SOL Spent by Target:', (totalSolSpent / 1e9).toFixed(6), 'SOL');

        // Check if target wallet is buying
        if (!buyTransfer || totalSolSpent === 0) {
            console.log('❌ SWAP CONDITIONS NOT MET:');
            console.log('   - Buy Transfer Found:', !!buyTransfer);
            console.log('   - Total SOL Spent > 0:', totalSolSpent > 0);
            logger.logInfo('swap', 'Target wallet not buying in this swap');
            return;
        }

        const tokenMint = buyTransfer.mint;
        const targetAmountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

        console.log('✅ SWAP CONDITIONS MET - PROCEEDING WITH COPY TRADE');
        console.log('🎯 Token Mint:', tokenMint);
        console.log('💰 Target Amount:', targetAmountInSol.toFixed(6), 'SOL');

        // Use fixed buy amount from environment variable
        const fixedBuyAmount = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.1');
        const ourTradeAmount = fixedBuyAmount;
        
        console.log('📊 TRADE CALCULATION:');
        console.log('   - Target Amount:', targetAmountInSol.toFixed(6), 'SOL');
        console.log('   - Fixed Buy Amount:', ourTradeAmount.toFixed(6), 'SOL');
        console.log('   - Final Trade Amount:', ourTradeAmount.toFixed(6), 'SOL');

        logger.logInfo('swap', `Target wallet bought: ${tokenMint} for ${targetAmountInSol} SOL`);
        logger.logInfo('swap', `Fixed buy amount: ${ourTradeAmount} SOL`);

        // Execute the copy trade
        try {
            console.log('🚀 EXECUTING COPY TRADE...');
            console.log('   - Token:', tokenMint);
            console.log('   - Amount:', ourTradeAmount.toFixed(6), 'SOL');
            
            await dexManager.executeSwap(tokenMint, ourTradeAmount);
            console.log('✅ COPY TRADE EXECUTED SUCCESSFULLY');
            logger.logInfo('swap', `Copy trade executed: Bought ${tokenMint} for ${ourTradeAmount} SOL`);
        } catch (err) {
            console.log('❌ COPY TRADE FAILED:');
            console.log('   - Error:', err instanceof Error ? err.message : String(err));
            console.log('   - Stack:', err instanceof Error ? err.stack : 'No stack trace');
            logger.logError('swap', 'Error executing copy trade', err instanceof Error ? err.message : String(err));
        }
        
        console.log('=== END SWAP PROCESSING ===\n');
    } catch (err) {
        logger.logError('swap', 'Error processing swap data', err instanceof Error ? err.message : String(err));
    }
}

async function handleTransfer(data: any) {
    try {
        const tokenTransfers = data.tokenTransfers || [];
        const nativeTransfers = data.nativeTransfers || [];
        const targetWallet = process.env.TARGET_WALLET_ADDRESS;

        console.log('\n🔄 === PROCESSING TRANSFER EVENT ===');
        console.log('🎯 Target Wallet:', targetWallet);
        console.log('📊 Token Transfers Count:', tokenTransfers.length);
        console.log('💰 Native Transfers Count:', nativeTransfers.length);

        logger.logInfo('transfer', 'Processing transfer event', `Target wallet: ${targetWallet}`);

        // Find the token being bought (token that was transferred TO the target wallet)
        const buyTransfer = tokenTransfers.find((transfer: any) => {
            const isTargetReceiver = transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
            console.log(`🔍 Checking transfer: ${transfer.mint || 'Unknown'}`);
            console.log(`   To User Account: ${transfer.toUserAccount}`);
            console.log(`   To Token Account: ${transfer.toTokenAccount}`);
            console.log(`   Target Wallet: ${targetWallet}`);
            console.log(`   Is Target Receiver: ${isTargetReceiver}`);
            return isTargetReceiver;
        });

        console.log('📦 Buy Transfer Found:', !!buyTransfer);
        if (buyTransfer) {
            console.log('   Token Mint:', buyTransfer.mint);
            console.log('   Token Amount:', buyTransfer.tokenAmount);
            console.log('   To User Account:', buyTransfer.toUserAccount);
            console.log('   To Token Account:', buyTransfer.toTokenAccount);
        }

        // Get the SOL amount spent by target wallet
        const solTransfersFromTarget = nativeTransfers.filter((transfer: any) => transfer.fromUserAccount === targetWallet);
        console.log('💸 SOL Transfers FROM Target:', solTransfersFromTarget.length);
        solTransfersFromTarget.forEach((transfer: any, index: number) => {
            console.log(`   ${index + 1}. Amount: ${(transfer.amount / 1e9).toFixed(6)} SOL (${transfer.amount} lamports)`);
            console.log(`      To: ${transfer.toUserAccount}`);
        });

        const totalSolSpent = solTransfersFromTarget.reduce((sum: number, transfer: any) => sum + transfer.amount, 0);
        console.log('💸 Total SOL Spent by Target:', (totalSolSpent / 1e9).toFixed(6), 'SOL');

        // Check if target wallet is buying (received tokens and spent SOL)
        if (!buyTransfer || totalSolSpent === 0) {
            console.log('❌ TRANSFER CONDITIONS NOT MET:');
            console.log('   - Buy Transfer Found:', !!buyTransfer);
            console.log('   - Total SOL Spent > 0:', totalSolSpent > 0);
            logger.logInfo('transfer', 'Target wallet not buying in this transfer');
            return;
        }

        const tokenMint = buyTransfer.mint;
        const targetAmountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

        // Use fixed buy amount from environment variable
        const fixedBuyAmount = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.1');
        const ourTradeAmount = fixedBuyAmount;

        logger.logInfo('transfer', `Target wallet bought: ${tokenMint} for ${targetAmountInSol} SOL`);
        logger.logInfo('transfer', `Fixed buy amount: ${ourTradeAmount} SOL`);

        // Execute the copy trade
        try {
            await dexManager.executeSwap(tokenMint, ourTradeAmount);
            logger.logInfo('transfer', `Copy trade executed: Bought ${tokenMint} for ${ourTradeAmount} SOL`);
        } catch (err) {
            logger.logError('transfer', 'Error executing copy trade', err instanceof Error ? err.message : String(err));
        }
    } catch (err) {
        logger.logError('transfer', 'Error processing transfer data', err instanceof Error ? err.message : String(err));
    }
}


// Status endpoint to check bot status
app.get('/status', async (req: Request, res: Response) => {
    try {
        const balance = await dexManager.getTokenBalance(process.env.TARGET_TOKEN_MINT || '');
        
        res.status(200).json({
            status: 'operational',
            timestamp: new Date().toISOString(),
            config: {
                fixedBuyAmount: process.env.FIXED_BUY_AMOUNT || '0.1',
                targetTokenMint: process.env.TARGET_TOKEN_MINT || 'not set',
                rpcUrl: process.env.SOLANA_RPC_URL ? 'configured' : 'not configured'
            },
            balance: balance
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handling middleware
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    logger.logError('webhook', 'Unhandled error', error.message);
    
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});



// 404 handler
app.use('*', (req: Request, res: Response) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /health',
            'GET /status',
            'POST /webhook'
        ],
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    logger.logInfo('server', 'Webhook server started', 
        `Server running on port ${PORT}, Environment: ${process.env.NODE_ENV || 'development'}`
    );
    
    console.log(`🚀 Pump.fun Sniper Bot Webhook Server running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: POST /webhook`);
    console.log(`🧪 Test webhook endpoint: POST /test-webhook`);
    console.log(`📊 Status endpoint: GET /status`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`🎯 Target Wallet: ${process.env.TARGET_WALLET_ADDRESS || 'NOT SET'}`);
    console.log(`💰 Fixed Buy Amount: ${process.env.FIXED_BUY_AMOUNT || 'NOT SET'}`);
    console.log(`🌐 Server URL: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}`);
});

// Add basic request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Self-ping function to keep server awake
function startSelfPing() {
    const pingInterval = 14 * 60 * 1000; // 14 minutes in milliseconds
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `https://sniper-tup2.onrender.com`;
    
    const pingServer = async () => {
        try {
            const response = await fetch(`${serverUrl}/health`);
            if (response.ok) {
                logger.logInfo('ping', 'Self-ping successful', `Server kept awake at ${new Date().toISOString()}`);
            } else {
                logger.logWarning('ping', 'Self-ping failed', `Status: ${response.status}`);
            }
        } catch (error) {
            logger.logError('ping', 'Self-ping error', error instanceof Error ? error.message : String(error));
        }
    };

    // Start the ping interval
    setInterval(pingServer, pingInterval);
    
    // Initial ping
    pingServer();
    
    logger.logInfo('ping', 'Self-ping started', `Pinging every ${pingInterval / 1000 / 60} minutes to keep server awake`);
}

// Start self-ping when server starts
startSelfPing();

export default app;
