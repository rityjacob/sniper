import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { dexManager } from './dex';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

if (!process.env.TARGET_WALLET_ADDRESS) {
  logger.logError('system', 'TARGET_WALLET_ADDRESS environment variable is not set');
  process.exit(1);
}

// Webhook endpoint for Helius
app.post('/webhook', async (req: Request, res: Response) => {
  console.log('=== WEBHOOK RECEIVED ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Timestamp:', new Date().toISOString());
  console.log('=== END WEBHOOK ===');
  
  logger.logInfo('webhook', 'Webhook received', JSON.stringify(req.body));
  
  res.sendStatus(200);

  try {
    let data = req.body;
    
    // If the payload is an array, process each event
    if (Array.isArray(data)) {
      logger.logInfo('webhook', `Processing ${data.length} events`);
      for (const event of data) {
        await handleEvent(event);
      }
    } else {
      logger.logInfo('webhook', 'Processing single event');
      await handleEvent(data);
    }
  } catch (err) {
    logger.logError('webhook', 'Error processing webhook', err instanceof Error ? err.message : String(err));
  }
});

async function handleEvent(data: any) {
  logger.logInfo('webhook', 'Processing event', JSON.stringify(data));
  
  // Only handle SWAP events
  if (data.type === 'SWAP') {
    await handleSwap(data);
  } else {
    logger.logInfo('webhook', `Ignoring event type: ${data.type}`);
  }
}

async function handleSwap(data: any) {
  try {
    const tokenTransfers = data.tokenTransfers || [];
    const nativeTransfers = data.nativeTransfers || [];
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;

    logger.logInfo('swap', 'Processing swap event', `Target wallet: ${targetWallet}`);

    // Find the token being bought (token that was transferred TO the target wallet)
    const buyTransfer = tokenTransfers.find((transfer: any) => {
      return transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
    });

    // Get the SOL amount spent
    const totalSolSpent = nativeTransfers
      .filter((transfer: any) => transfer.fromUserAccount === targetWallet)
      .reduce((sum: number, transfer: any) => sum + transfer.amount, 0);

    // Check if target wallet is buying
    if (!buyTransfer || totalSolSpent === 0) {
      logger.logInfo('swap', 'Target wallet not buying in this swap');
      return;
    }

    const tokenMint = buyTransfer.mint;
    const amountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

    logger.logInfo('swap', `Target wallet bought: ${tokenMint} for ${amountInSol} SOL`);

    // Execute the copy trade
    try {
      await dexManager.executeSwap(tokenMint, amountInSol);
      logger.logInfo('swap', `Copy trade executed: Bought ${tokenMint} for ${amountInSol} SOL`);
    } catch (err) {
      logger.logError('swap', 'Error executing copy trade', err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    logger.logError('swap', 'Error processing swap data', err instanceof Error ? err.message : String(err));
  }
}

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  const healthInfo = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    targetWallet: process.env.TARGET_WALLET_ADDRESS ? 'Set' : 'Not Set',
    port: PORT
  };
  res.status(200).json(healthInfo);
});

app.listen(PORT, () => {
  logger.logInfo('server', `Webhook server running on port ${PORT}`);
}); 