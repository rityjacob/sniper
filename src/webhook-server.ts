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
    
    // Display the complete webhook payload
    console.log('\n📋 COMPLETE WEBHOOK PAYLOAD:');
    console.log(JSON.stringify(req.body, null, 2));
    
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
        logger.logInfo('webhook', 'Received Helius webhook', 'Processing all webhook data');

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
        let buyTransactionsCount = 0;

        for (const tx of transactions) {
            try {
                // Log ALL transactions for debugging
                logger.logInfo('webhook', 'Transaction received', 
                    `Type: ${tx.type || 'unknown'}, Program: ${tx.programId || 'unknown'}, Signature: ${tx.signature?.slice(0, 8) || 'unknown'}...`
                );
                
                console.log(`\n🔍 ANALYZING TRANSACTION: ${tx.signature?.slice(0, 8) || 'unknown'}...`);
                console.log(`   Type: ${tx.type || 'unknown'}`);
                console.log(`   Program: ${tx.programId || 'unknown'}`);
                
                // Check if this is a buy transaction by analyzing token transfers
                const isBuyTransaction = await checkIfBuyTransaction(tx);
                
                if (isBuyTransaction) {
                    buyTransactionsCount++;
                    console.log('🟢 BUY TRANSACTION DETECTED - TRIGGERING BOT');
                    
                    // Extract transaction details for Pump.fun
                    const webhookData = extractWebhookData(tx);
                    
                    // Extract fixed buy amount from environment or use default
                    const fixedBuyAmount = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.1');
                    
                    logger.logInfo('webhook', 'Executing buy trade', 
                        `Fixed buy amount: ${fixedBuyAmount} SOL, Token: ${webhookData.outputMint}`
                    );

                    // Process the webhook and execute trade
                    const signature = await dexManager.processLeaderBuyWebhook(webhookData, fixedBuyAmount);
                    
                    logger.logInfo('webhook', 'Buy trade completed', 
                        `Signature: ${signature}, Token: ${webhookData.outputMint}`
                    );
                } else {
                    console.log('🔴 NOT A BUY TRANSACTION - SKIPPING');
                    logger.logInfo('webhook', 'Skipping non-buy transaction', 
                        `Type: ${tx.type}, Program: ${tx.programId}`
                    );
                }
                
                processedCount++;
            } catch (error: any) {
                logger.logError('webhook', 'Transaction processing failed', error.message);
                console.log(`❌ ERROR PROCESSING TRANSACTION: ${error.message}`);
            }
        }

        // Return success response
        res.status(200).json({
            success: true,
            message: `Processed ${processedCount} transaction(s), ${buyTransactionsCount} buy transaction(s)`,
            timestamp: new Date().toISOString(),
            summary: {
                totalTransactions: transactions.length,
                processedTransactions: processedCount,
                buyTransactions: buyTransactionsCount
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

/**
 * Check if a transaction is a buy transaction
 */
async function checkIfBuyTransaction(tx: any): Promise<boolean> {
    try {
        const tokenTransfers = tx.tokenTransfers || [];
        const nativeTransfers = tx.nativeTransfers || [];
        const targetWallet = process.env.TARGET_WALLET_ADDRESS;
        
        if (!targetWallet) {
            console.log('   ❌ No target wallet configured');
            return false;
        }
        
        console.log(`   🎯 Target Wallet: ${targetWallet}`);
        console.log(`   📦 Token Transfers: ${tokenTransfers.length}`);
        console.log(`   💰 Native Transfers: ${nativeTransfers.length}`);
        
        // Find if target wallet is receiving tokens (buying)
        const targetReceivingTokens = tokenTransfers.some((transfer: any) => 
            transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet
        );
        
        // Find if target wallet is sending SOL (paying for tokens)
        const targetSendingSol = nativeTransfers.some((transfer: any) => 
            transfer.fromUserAccount === targetWallet
        );
        
        console.log(`   📥 Target Receiving Tokens: ${targetReceivingTokens}`);
        console.log(`   💸 Target Sending SOL: ${targetSendingSol}`);
        
        // It's a buy transaction if target is receiving tokens and sending SOL
        const isBuy = targetReceivingTokens && targetSendingSol;
        
        if (isBuy) {
            const receivedToken = tokenTransfers.find((transfer: any) => 
                transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet
            );
            const sentSol = nativeTransfers.find((transfer: any) => 
                transfer.fromUserAccount === targetWallet
            );
            
            console.log(`   🟢 BUY CONFIRMED:`);
            console.log(`      Token: ${receivedToken?.mint || 'unknown'}`);
            console.log(`      Amount: ${(parseInt(sentSol?.amount || '0') / 1e9).toFixed(6)} SOL`);
        } else {
            console.log(`   🔴 NOT A BUY TRANSACTION`);
        }
        
        return isBuy;
    } catch (error) {
        console.log(`   ❌ ERROR CHECKING BUY TRANSACTION: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Extract webhook data for Pump.fun processing
 */
function extractWebhookData(tx: any): any {
    const tokenTransfers = tx.tokenTransfers || [];
    const nativeTransfers = tx.nativeTransfers || [];
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    
    // Find the token being bought
    const buyTransfer = tokenTransfers.find((transfer: any) => 
        transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet
    );
    
    // Find the SOL amount spent
    const solTransfer = nativeTransfers.find((transfer: any) => 
        transfer.fromUserAccount === targetWallet
    );
    
    const webhookData = {
        inputMint: 'So11111111111111111111111111111111111111112', // WSOL
        outputMint: buyTransfer?.mint || '',
        amount: solTransfer?.amount || '0',
        programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61', // Pump.fun program ID
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.timestamp,
        accounts: tx.accountData?.map((acc: any) => acc.account) || [],
        data: tx.instructions?.[0]?.data || '',
        transaction: tx // Include full transaction data for enhanced processing
    };
    
    return webhookData;
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
                rpcUrl: process.env.SOLANA_RPC_URL ? 'configured' : 'not configured',
                targetWallet: process.env.TARGET_WALLET_ADDRESS || 'not set'
            },
            balance: balance,
                    webhookInfo: {
                endpoint: '/webhook',
                testEndpoint: '/test-webhook',
                healthEndpoint: '/health',
                expectedTransactionTypes: ['ALL TRANSACTIONS FROM HELIUS'],
                targetWallet: process.env.TARGET_WALLET_ADDRESS || 'not set',
                functionality: 'Receives all webhooks, filters for buy transactions, triggers Pump.fun trades'
            }
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
    
    console.log(`🚀 Universal Webhook Bot Server running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: POST /webhook (receives ALL Helius webhooks)`);
    console.log(`🧪 Test webhook endpoint: POST /test-webhook`);
    console.log(`📊 Status endpoint: GET /status`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`🎯 Target Wallet: ${process.env.TARGET_WALLET_ADDRESS || 'NOT SET'}`);
    console.log(`💰 Fixed Buy Amount: ${process.env.FIXED_BUY_AMOUNT || 'NOT SET'}`);
    console.log(`🔍 Functionality: Receives all webhooks → Filters for buy transactions → Triggers Pump.fun trades`);
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
