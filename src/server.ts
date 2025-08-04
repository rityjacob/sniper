import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { dexManager } from './dex';
import { logger } from './utils/logger';
import { buyPrices } from './profitTracker';
import { transactionManager } from './transaction';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

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
  
  // Handle different transaction types
  switch (data.type) {
    case 'SWAP':
      await handleSwap(data);
      break;
    case 'NFT_SALE':
      logger.logInfo('system', '📦 NFT Sale detected - not copying (NFTs not supported)');
      break;
    case 'TRANSFER':
      logger.logInfo('system', '💸 Transfer detected - checking if it involves target wallet');
      await handleTransfer(data);
      break;
    case 'TOKEN_MINT':
      logger.logInfo('system', '🪙 Token Mint detected - not copying');
      break;
    case 'TOKEN_BURN':
      logger.logInfo('system', '🔥 Token Burn detected - not copying');
      break;
    default:
      logger.logInfo('system', `⚠️ Unhandled event type: ${data.type}`);
      // Log the full data for debugging
      logger.logInfo('system', 'Full transaction data for debugging:', JSON.stringify(data, null, 2));
  }
}

async function handleTransfer(data: any) {
  try {
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    const tokenTransfers = data.tokenTransfers || [];
    const nativeTransfers = data.nativeTransfers || [];

    // Check if target wallet is involved in any transfers
    const targetInvolved = tokenTransfers.some((transfer: any) => 
      transfer.fromUserAccount === targetWallet || 
      transfer.toUserAccount === targetWallet ||
      transfer.fromTokenAccount === targetWallet || 
      transfer.toTokenAccount === targetWallet
    );

    const targetInNativeTransfer = nativeTransfers.some((transfer: any) =>
      transfer.fromUserAccount === targetWallet ||
      transfer.toUserAccount === targetWallet
    );

    if (targetInvolved || targetInNativeTransfer) {
      logger.logInfo('system', '🎯 Target wallet involved in transfer transaction');
      logger.logInfo('system', 'Token transfers:', JSON.stringify(tokenTransfers, null, 2));
      logger.logInfo('system', 'Native transfers:', JSON.stringify(nativeTransfers, null, 2));
      
      // For now, just log the transfer - you can add copy logic here if needed
      logger.logInfo('system', 'Transfer detected but not copying (transfer copying not implemented)');
    } else {
      logger.logInfo('system', 'Target wallet not involved in this transfer');
    }
  } catch (err) {
    logger.logError('system', '❌ Error processing transfer', err instanceof Error ? err.message : String(err));
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

    // Find the token being traded (token that was transferred FROM the target wallet)
    const sellTransfer = tokenTransfers.find((transfer: any) => {
      const isTargetWalletSelling = 
        transfer.fromUserAccount === targetWallet ||
        transfer.fromTokenAccount === targetWallet;
      
      if (isTargetWalletSelling) {
        logger.logInfo('system', 'Found target wallet selling transfer', JSON.stringify(transfer, null, 2));
      }
      
      return isTargetWalletSelling;
    });

    // Find the token being bought (token that was transferred TO the target wallet)
    const buyTransfer = tokenTransfers.find((transfer: any) => {
      const isTargetWalletBuying = 
        transfer.toUserAccount === targetWallet ||
        transfer.toTokenAccount === targetWallet;
      
      if (isTargetWalletBuying) {
        logger.logInfo('system', 'Found target wallet buying transfer', JSON.stringify(transfer, null, 2));
      }
      
      return isTargetWalletBuying;
    });

    // Get the SOL amount from native transfers
    const nativeTransfers = data.nativeTransfers || [];
    const totalSolSpent = nativeTransfers
      .filter((transfer: any) => transfer.fromUserAccount === targetWallet)
      .reduce((sum: number, transfer: any) => sum + transfer.amount, 0);
    const totalSolReceived = nativeTransfers
      .filter((transfer: any) => transfer.toUserAccount === targetWallet)
      .reduce((sum: number, transfer: any) => sum + transfer.amount, 0);

    // Determine if this is a buy or sell
    const isTargetWalletBuying = totalSolSpent > 0 && buyTransfer;
    const isTargetWalletSelling = totalSolReceived > 0 && sellTransfer;

    if (isTargetWalletSelling) {
      logger.logInfo('system', `🔄 Target wallet SOLD: ${sellTransfer.mint}, Amount: ${sellTransfer.tokenAmount} tokens, Received: ${totalSolReceived / 1e9} SOL`);
      logger.logInfo('system', 'Target wallet sold tokens, skipping copy trade (we only copy buys)');
      return;
    }

    if (!isTargetWalletBuying) {
      logger.logWarning('system', 'No buy transaction detected from target wallet');
      return;
    }

    const tokenMint = buyTransfer.mint;
    const amountInTokens = buyTransfer.tokenAmount;
    const amountInSol = totalSolSpent / 1e9;

    logger.logInfo('system', `🔄 Target wallet BOUGHT: ${tokenMint}, Amount: ${amountInTokens} tokens, Spent: ${amountInSol} SOL`);

    // Get the current price in SOL for the token
    let currentPrice = 0;
    try {
      currentPrice = await dexManager.getTokenPrice(tokenMint);
    } catch (err) {
      logger.logError('system', '❌ Error fetching token price', err instanceof Error ? err.message : String(err));
    }

    // Trigger the bot's buy logic
    try {
      // Construct a transaction object for safety checks and trade sizing
      const tx = {
        signature: data.signature || '',
        timestamp: data.timestamp || Date.now(),
        tokenAddress: tokenMint,
        amount: amountInSol.toString(),
        type: 'buy' as const
      };
      // Run through transaction manager (enforces all limits)
      const isSafe = await transactionManager.processTransaction(tx);
      if (isSafe) {
        await dexManager.executeSwap(tokenMint, Number(tx.amount));
        logger.logInfo('system', `🚀 Copy trade triggered: Bought ${tokenMint} for ${tx.amount} SOL`);
        // Track the buy price and amount
        if (currentPrice > 0) {
          buyPrices[tokenMint] = { price: currentPrice, amount: Number(tx.amount) };
          logger.logInfo('system', `💾 Tracked buy: ${tokenMint} at ${currentPrice} SOL`);
        }
      } else {
        logger.logWarning('system', 'Trade did not pass safety checks, not executing swap');
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

// Test webhook endpoint for debugging
app.post('/test-webhook', (req: Request, res: Response) => {
  console.log('=== TEST WEBHOOK RECEIVED ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Timestamp:', new Date().toISOString());
  console.log('=== END TEST WEBHOOK ===');
  
  res.status(200).json({ 
    status: 'OK', 
    message: 'Test webhook received and logged',
    timestamp: new Date().toISOString()
  });
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