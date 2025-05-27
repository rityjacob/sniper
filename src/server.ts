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

// Webhook endpoint for Helius
app.post('/webhook', async (req: Request, res: Response) => {
  res.sendStatus(200); // Respond immediately to Helius

  try {
    const data = req.body;
    logger.logInfo('system', '🔔 Webhook received', JSON.stringify(data));

    // Only handle SWAP events for copy trading
    if (data.type === 'SWAP' && data.events && data.events.swap) {
      await handleSwap(data);
    } else {
      logger.logInfo('system', `⚠️ Unhandled event type: ${data.type}`);
    }
  } catch (err) {
    logger.logError('system', '❌ Error processing webhook', err instanceof Error ? err.message : String(err));
  }
});

async function handleSwap(data: any) {
  const swap = data?.events?.swap;
  if (!swap) return;

  try {
    // Extract tokenOut (the token bought) and amountIn (SOL spent)
    const tokenMint = swap.tokenOut;
    const amountInLamports = swap.amountIn;
    const amountInSol = amountInLamports / 1e9;

    logger.logInfo('system', `🔄 Swap detected. Token: ${tokenMint}, Amount: ${amountInSol} SOL`);

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
    logger.logError('system', '❌ Error processing swap', err instanceof Error ? err.message : String(err));
  }
}

// Periodically check for profit targets and auto-sell
setInterval(async () => {
  for (const tokenMint in buyPrices) {
    const { price: buyPrice, amount } = buyPrices[tokenMint];
    let currentPrice = 0;
    try {
      currentPrice = await dexManager.getTokenPrice(tokenMint);
    } catch (err) {
      logger.logError('system', '❌ Error fetching token price for sell check', err instanceof Error ? err.message : String(err));
      continue;
    }
    if (currentPrice >= buyPrice * 1.5) {
      try {
        await dexManager.sellToken(tokenMint, amount);
        logger.logInfo('system', `🎉 Sold ${tokenMint} for 150% profit! (Buy: ${buyPrice}, Sell: ${currentPrice})`);
        delete buyPrices[tokenMint];
      } catch (err) {
        logger.logError('system', '❌ Error executing auto-sell', err instanceof Error ? err.message : String(err));
      }
    }
  }
}, 60 * 1000); // Check every minute

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('OK');
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