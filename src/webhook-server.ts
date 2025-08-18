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

// Webhook endpoint for Pump.fun leader buy detection
app.post('/webhook/pump-fun', async (req: Request, res: Response) => {
    try {
        logger.logInfo('webhook', 'Received webhook', 'Processing Pump.fun webhook data');

        // Log the actual webhook data for debugging
        logger.logInfo('webhook', 'Webhook payload', JSON.stringify(req.body, null, 2));

        // Validate webhook data
        const webhookData: PumpFunWebhook = req.body;
        
        if (!webhookData) {
            logger.logError('webhook', 'No webhook data received', 'Empty request body');
            return res.status(400).json({ 
                error: 'No webhook data received',
                timestamp: new Date().toISOString()
            });
        }

        // Log what fields are missing
        const missingFields = [];
        if (!webhookData.inputMint) missingFields.push('inputMint');
        if (!webhookData.outputMint) missingFields.push('outputMint');
        if (!webhookData.amount) missingFields.push('amount');
        
        if (missingFields.length > 0) {
            logger.logError('webhook', 'Invalid webhook data', `Missing required fields: ${missingFields.join(', ')}`);
            return res.status(400).json({ 
                error: `Invalid webhook data - missing required fields: ${missingFields.join(', ')}`,
                receivedFields: Object.keys(webhookData),
                timestamp: new Date().toISOString()
            });
        }

        // Log webhook details
        logger.logInfo('webhook', 'Webhook data received', 
            `Input: ${webhookData.inputMint}, Output: ${webhookData.outputMint}, Amount: ${webhookData.amount}`
        );

        // Check if this is a Pump.fun transaction
        if (webhookData.programId !== 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61') {
            logger.logInfo('webhook', 'Not a Pump.fun transaction', `Program ID: ${webhookData.programId}`);
            return res.status(200).json({
                success: true,
                message: 'Not a Pump.fun transaction - skipping',
                timestamp: new Date().toISOString()
            });
        }

        // Extract fixed buy amount from environment or use default
        const fixedBuyAmount = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.1');
        
        logger.logInfo('webhook', 'Executing trade', 
            `Fixed buy amount: ${fixedBuyAmount} SOL`
        );

        // Process the webhook and execute trade
        const signature = await dexManager.processLeaderBuyWebhook(webhookData, fixedBuyAmount);

        // Return success response
        res.status(200).json({
            success: true,
            signature: signature,
            message: 'Trade executed successfully',
            timestamp: new Date().toISOString(),
            tradeDetails: {
                tokenMint: webhookData.outputMint,
                amount: fixedBuyAmount,
                signature: signature
            }
        });

        logger.logInfo('webhook', 'Trade completed', 
            `Signature: ${signature}, Token: ${webhookData.outputMint}`
        );

    } catch (error: any) {
        logger.logError('webhook', 'Webhook processing failed', error.message);
        
        // Return error response
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            details: {
                inputMint: req.body?.inputMint,
                outputMint: req.body?.outputMint,
                amount: req.body?.amount
            }
        });
    }
});

// Webhook endpoint with custom buy amount
app.post('/webhook/pump-fun/:amount', async (req: Request, res: Response) => {
    try {
        logger.logInfo('webhook', 'Received webhook with custom amount', 'Processing Pump.fun webhook data');

        const webhookData: PumpFunWebhook = req.body;
        const customAmount = parseFloat(req.params.amount);

        if (isNaN(customAmount) || customAmount <= 0) {
            logger.logError('webhook', 'Invalid custom amount', `Amount: ${req.params.amount}`);
            return res.status(400).json({ 
                error: 'Invalid custom amount',
                timestamp: new Date().toISOString()
            });
        }

        // Validate webhook data
        if (!webhookData || !webhookData.inputMint || !webhookData.outputMint || !webhookData.amount) {
            logger.logError('webhook', 'Invalid webhook data', 'Missing required fields');
            return res.status(400).json({ 
                error: 'Invalid webhook data - missing required fields',
                timestamp: new Date().toISOString()
            });
        }

        logger.logInfo('webhook', 'Executing trade with custom amount', 
            `Custom amount: ${customAmount} SOL`
        );

        // Process the webhook and execute trade
        const signature = await dexManager.processLeaderBuyWebhook(webhookData, customAmount);

        // Return success response
        res.status(200).json({
            success: true,
            signature: signature,
            message: 'Trade executed successfully',
            timestamp: new Date().toISOString(),
            tradeDetails: {
                tokenMint: webhookData.outputMint,
                amount: customAmount,
                signature: signature
            }
        });

        logger.logInfo('webhook', 'Trade completed with custom amount', 
            `Signature: ${signature}, Amount: ${customAmount} SOL`
        );

    } catch (error: any) {
        logger.logError('webhook', 'Webhook processing failed', error.message);
        
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

// Generic webhook endpoint for debugging
app.post('/webhook', async (req: Request, res: Response) => {
    try {
        logger.logInfo('webhook', 'Received generic webhook', 'Logging webhook data for debugging');
        
        // Log the entire webhook payload
        logger.logInfo('webhook', 'Generic webhook payload', JSON.stringify(req.body, null, 2));
        
        // Check if it's a Pump.fun webhook
        if (req.body.programId === 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61') {
            logger.logInfo('webhook', 'Pump.fun webhook detected', 'Redirecting to pump-fun endpoint');
            // Forward to the pump-fun endpoint
            return app._router.handle(req, res, () => {
                // If forwarding fails, return success anyway
                res.status(200).json({
                    success: true,
                    message: 'Pump.fun webhook received and processed',
                    timestamp: new Date().toISOString()
                });
            });
        }
        
        res.status(200).json({
            success: true,
            message: 'Generic webhook received',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        logger.logError('webhook', 'Generic webhook error', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /health',
            'GET /status',
            'POST /webhook',
            'POST /webhook/pump-fun',
            'POST /webhook/pump-fun/:amount'
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
    console.log(`📡 Webhook endpoint: POST /webhook/pump-fun`);
    console.log(`📊 Status endpoint: GET /status`);
    console.log(`❤️  Health check: GET /health`);
});

export default app;
