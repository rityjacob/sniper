import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { dexManager } from './dex';
import { logger } from './utils/logger';
// If you see type errors for express or body-parser, run:
// npm install --save-dev @types/express @types/body-parser

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

    // Trigger the bot's buy logic
    try {
      await dexManager.executeSwap(tokenMint, amountInSol);
      logger.logInfo('system', `🚀 Copy trade triggered: Bought ${tokenMint} for ${amountInSol} SOL`);
    } catch (err) {
      logger.logError('system', '❌ Error executing copy trade', err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    logger.logError('system', '❌ Error processing swap', err instanceof Error ? err.message : String(err));
  }
}

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  logger.logInfo('system', `🚀 Webhook server running on port ${PORT}`);
}); 