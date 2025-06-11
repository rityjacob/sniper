import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { dexManager } from './dex';
import { logger } from './utils/logger';
import { buyPrices } from './profitTracker';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Add this at the top of the file after imports
if (!process.env.TARGET_WALLET_ADDRESS) {
  logger.logError('system', '❌ TARGET_WALLET_ADDRESS environment variable is not set');
  process.exit(1);
}

// Webhook endpoint for Helius
app.post('/webhook', async (req: Request, res: Response) => {
  logger.logInfo('system', '📥 Webhook request received', JSON.stringify({
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  }, null, 2));

  res.sendStatus(200);

  try {
    let data = req.body;
    // If the payload is an array, process each event
    if (Array.isArray(data)) {
      logger.logInfo('system', `Processing ${data.length} events`);
      for (const event of data) {
        await handleEvent(event);
      }
    } else {
      logger.logInfo('system', 'Processing single event');
      await handleEvent(data);
    }
  } catch (err) {
    logger.logError('system', '❌ Error processing webhook', err instanceof Error ? err.message : String(err));
  }
});

async function handleEvent(data: any) {
  logger.logInfo('system', '🔔 Webhook received', JSON.stringify(data));
  if (data.type === 'SWAP') {
    await handleSwap(data);
  } else {
    logger.logInfo('system', `⚠️ Unhandled event type: ${data.type}`);
  }
}

async function handleSwap(data: any) {
  try {
    // Extract token information from the new format
    const tokenTransfers = data.tokenTransfers || [];
    if (tokenTransfers.length === 0) {
      logger.logWarning('system', 'No token transfers found in swap data');
      return;
    }

    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    logger.logInfo('system', 'Target wallet address', targetWallet);

    // Log all token transfers for debugging
    logger.logInfo('system', 'Token transfers', JSON.stringify(tokenTransfers, null, 2));

    // Find the token being bought (token that was transferred to the target wallet)
    const buyTransfer = tokenTransfers.find((transfer: any) => {
      const isTargetWallet = 
        transfer.toUserAccount === targetWallet ||
        transfer.toTokenAccount === targetWallet;
      
      if (isTargetWallet) {
        logger.logInfo('system', 'Found matching transfer', JSON.stringify(transfer, null, 2));
      }
      
      return isTargetWallet;
    });

    if (!buyTransfer) {
      logger.logWarning('system', 'No buy transfer found in swap data');
      return;
    }

    const tokenMint = buyTransfer.mint;
    const amountInTokens = buyTransfer.tokenAmount;

    // Get the SOL amount from native transfers
    const nativeTransfers = data.nativeTransfers || [];
    // Sum all SOL sent from the target wallet
    const totalSolSpent = nativeTransfers
      .filter((transfer: any) => transfer.fromUserAccount === targetWallet)
      .reduce((sum: number, transfer: any) => sum + transfer.amount, 0);
    const amountInSol = totalSolSpent / 1e9;

    logger.logInfo('system', `🔄 Swap detected. Token: ${tokenMint}, Amount: ${amountInTokens} tokens (${amountInSol} SOL)`);

    // Get the current price in SOL for the token
    let currentPrice = 0;
    try {
      currentPrice = await dexManager.getTokenPrice(tokenMint);
    } catch (err) {
      logger.logError('system', '❌ Error fetching token price', err instanceof Error ? err.message : String(err));
    }

    // Trigger the bot's buy logic
    try {
      await dexManager.executeSwap(tokenMint, amountInSol);
      logger.logInfo('system', `🚀 Copy trade triggered: Bought ${tokenMint} for ${amountInSol} SOL`);
      // Track the buy price and amount
      if (currentPrice > 0) {
        buyPrices[tokenMint] = { price: currentPrice, amount: amountInSol };
        logger.logInfo('system', `💾 Tracked buy: ${tokenMint} at ${currentPrice} SOL`);
      }
    } catch (err) {
      logger.logError('system', '❌ Error executing copy trade', err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    logger.logError('system', '❌ Error processing swap data', err instanceof Error ? err.message : String(err));
  }
}

// Periodically check for profit targets and auto-sell
const PRICE_CHECK_INTERVAL = 15 * 60 * 1000; // Check every 5 minutes instead of every minute
const lastPriceCheck: Record<string, number> = {};

setInterval(async () => {
    const now = Date.now();
    for (const tokenMint in buyPrices) {
        // Only check price if 5 minutes have passed since last check
        if (lastPriceCheck[tokenMint] && now - lastPriceCheck[tokenMint] < PRICE_CHECK_INTERVAL) {
            continue;
        }
        
        const { price: buyPrice, amount } = buyPrices[tokenMint];
        let currentPrice = 0;
        try {
            currentPrice = await dexManager.getTokenPrice(tokenMint);
            lastPriceCheck[tokenMint] = now;
        } catch (err) {
            logger.logError('system', '❌ Error fetching token price for sell check', err instanceof Error ? err.message : String(err));
            continue;
        }
        if (currentPrice >= buyPrice * 1.5) {
            try {
                await dexManager.sellToken(tokenMint, amount);
                logger.logInfo('system', `🎉 Sold ${tokenMint} for 150% profit! (Buy: ${buyPrice}, Sell: ${currentPrice})`);
                delete buyPrices[tokenMint];
                delete lastPriceCheck[tokenMint];
            } catch (err) {
                logger.logError('system', '❌ Error executing auto-sell', err instanceof Error ? err.message : String(err));
            }
        }
    }
}, PRICE_CHECK_INTERVAL);

// Health check endpoint with more detailed response
app.get('/health', (_req: Request, res: Response) => {
  const healthInfo = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    targetWallet: process.env.TARGET_WALLET_ADDRESS ? 'Set' : 'Not Set',
    port: PORT
  };
  res.status(200).json(healthInfo);
});

app.listen(PORT, () => {
  logger.logInfo('system', `🚀 Webhook server running on port ${PORT}`);
});

// Self-ping to keep Render server awake
const SELF_URL = process.env.SELF_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(`${SELF_URL}/health`)
      .then((res: any) => console.log(`[Self-ping] Status: ${res.status}`))
      .catch((err: any) => console.error('[Self-ping] Error:', err));
  }, 14 * 60 * 1000); // Every 10 minutes
} 