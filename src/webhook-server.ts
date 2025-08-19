import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { dexManager } from './dex';
import { PumpFunWebhook } from './types';
import { logger } from './utils/logger';
import { config } from 'dotenv';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Handle large webhook payloads
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'Pump.fun Sniper Bot'
    });
});

// Main webhook endpoint for Helius enhanced webhooks
app.post('/webhook', async (req: Request, res: Response) => {
    try {
        logger.logInfo('webhook', 'Received Helius webhook', 'Processing enhanced webhook data');

        // Log the actual webhook data for debugging
        logger.logInfo('webhook', 'Webhook payload', JSON.stringify(req.body, null, 2));

        // Validate webhook data
        if (!req.body || !Array.isArray(req.body)) {
            logger.logWarning('webhook', 'Invalid webhook format', 'Expected array of transactions');
            return res.status(200).json({ 
                success: false,
                message: 'Invalid webhook format - expected array of transactions',
                timestamp: new Date().toISOString()
            });
        }

        const transactions = req.body;
        logger.logInfo('webhook', 'Processing transactions', `Received ${transactions.length} transaction(s)`);

        let processedCount = 0;
        let pumpFunCount = 0;

        for (const tx of transactions) {
            try {
                // Check if this is a Pump.fun transaction
                if (tx.type === 'SWAP' && tx.programId === 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61') {
                    pumpFunCount++;
                    
                    logger.logInfo('webhook', 'Pump.fun SWAP detected', 
                        `Token: ${tx.tokenTransfers?.[0]?.mint || 'unknown'}, Amount: ${tx.nativeTransfers?.[0]?.amount || 'unknown'}`
                    );

                    // Extract transaction details
                    const webhookData = {
                        inputMint: tx.nativeTransfers?.[0]?.fromUserAccount || 'So11111111111111111111111111111111111111112',
                        outputMint: tx.tokenTransfers?.[0]?.mint || '',
                        amount: tx.nativeTransfers?.[0]?.amount || '0',
                        programId: tx.programId,
                        signature: tx.signature,
                        slot: tx.slot,
                        blockTime: tx.blockTime,
                        accounts: tx.accountData || [],
                        data: tx.rawTransaction || ''
                    };

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
                    logger.logInfo('webhook', 'Non-Pump.fun transaction', 
                        `Type: ${tx.type}, Program: ${tx.programId}`
                    );
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
    console.log(`📊 Status endpoint: GET /status`);
    console.log(`❤️  Health check: GET /health`);
});

// Add basic request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

export default app;
