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
  console.log('Timestamp:', new Date().toISOString());
  console.log('Event Type:', req.body.type || 'Unknown');
  console.log('Signature:', req.body.signature || 'N/A');
  
  // Format the payload in a readable way
  if (req.body.tokenTransfers && req.body.tokenTransfers.length > 0) {
    console.log('\n📦 TOKEN TRANSFERS:');
    req.body.tokenTransfers.forEach((transfer: any, index: number) => {
      console.log(`  ${index + 1}. ${transfer.mint || 'Unknown Token'}`);
      console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
      console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
      console.log(`     Amount: ${transfer.tokenAmount || 'N/A'}`);
      console.log('');
    });
  }
  
  if (req.body.nativeTransfers && req.body.nativeTransfers.length > 0) {
    console.log('💰 NATIVE TRANSFERS (SOL):');
    req.body.nativeTransfers.forEach((transfer: any, index: number) => {
      const amountInSol = transfer.amount ? (transfer.amount / 1e9).toFixed(6) : 'N/A';
      console.log(`  ${index + 1}. ${amountInSol} SOL`);
      console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
      console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
      console.log('');
    });
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
    }
  }
  
  console.log('=== END WEBHOOK ===\n');
  
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
    const targetAmountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

    // Use fixed SOL amount per trade (configurable via environment)
    const { FIXED_SOL_PER_TRADE } = await import('./config');
    const ourTradeAmount = FIXED_SOL_PER_TRADE;

    logger.logInfo('swap', `Target wallet bought: ${tokenMint} for ${targetAmountInSol} SOL`);
    logger.logInfo('swap', `Using fixed trade amount: ${ourTradeAmount} SOL (configured via FIXED_SOL_PER_TRADE)`);

    // Execute the copy trade
    try {
      await dexManager.executeSwap(tokenMint, ourTradeAmount);
      logger.logInfo('swap', `Copy trade executed: Bought ${tokenMint} for ${ourTradeAmount} SOL`);
    } catch (err) {
      logger.logError('swap', 'Error executing copy trade', err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    logger.logError('swap', 'Error processing swap data', err instanceof Error ? err.message : String(err));
  }
}

async function handleTransfer(data: any) {
  try {
    const tokenTransfers = data.tokenTransfers || [];
    const nativeTransfers = data.nativeTransfers || [];
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;

    logger.logInfo('transfer', 'Processing transfer event', `Target wallet: ${targetWallet}`);

    // Find the token being bought (token that was transferred TO the target wallet)
    const buyTransfer = tokenTransfers.find((transfer: any) => {
      return transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
    });

    // Get the SOL amount spent by target wallet
    const totalSolSpent = nativeTransfers
      .filter((transfer: any) => transfer.fromUserAccount === targetWallet)
      .reduce((sum: number, transfer: any) => sum + transfer.amount, 0);

    // Check if target wallet is buying (received tokens and spent SOL)
    if (!buyTransfer || totalSolSpent === 0) {
      logger.logInfo('transfer', 'Target wallet not buying in this transfer');
      return;
    }

    const tokenMint = buyTransfer.mint;
    const targetAmountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

    // Use fixed SOL amount per trade (configurable via environment)
    const { FIXED_SOL_PER_TRADE } = await import('./config');
    const ourTradeAmount = FIXED_SOL_PER_TRADE;

    logger.logInfo('transfer', `Target wallet bought: ${tokenMint} for ${targetAmountInSol} SOL`);
    logger.logInfo('transfer', `Using fixed trade amount: ${ourTradeAmount} SOL (configured via FIXED_SOL_PER_TRADE)`);

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

// Self-ping mechanism to keep bot alive and monitor health
let selfPingInterval: NodeJS.Timeout;

function startSelfPing() {
  const { SELF_PING_INTERVAL_MINUTES } = require('./config');
  const pingInterval = SELF_PING_INTERVAL_MINUTES * 60 * 1000; // Convert minutes to milliseconds
  
  selfPingInterval = setInterval(async () => {
    try {
      const startTime = Date.now();
      
      // Ping our own health endpoint
      const response = await fetch(`http://localhost:${PORT}/health`);
      const healthData = await response.json();
      
      const pingTime = Date.now() - startTime;
      
      logger.logInfo('self-ping', `Bot health check - Status: ${healthData.status}, Response time: ${pingTime}ms`);
      
      // Additional health checks
      const { walletManager } = await import('./wallet');
      const balance = await walletManager.getBalance();
      logger.logInfo('self-ping', `Wallet balance: ${balance.toFixed(4)} SOL`);
      
    } catch (error) {
      logger.logError('self-ping', 'Self-ping failed', error instanceof Error ? error.message : String(error));
    }
  }, pingInterval);
  
  logger.logInfo('self-ping', `Self-ping mechanism started (every ${pingInterval / 1000 / 60} minutes)`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.logInfo('server', 'Shutting down gracefully...');
  if (selfPingInterval) {
    clearInterval(selfPingInterval);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.logInfo('server', 'Shutting down gracefully...');
  if (selfPingInterval) {
    clearInterval(selfPingInterval);
  }
  process.exit(0);
});

app.listen(PORT, () => {
  logger.logInfo('server', `Webhook server running on port ${PORT}`);
  
  // Start self-ping after server is running
  setTimeout(() => {
    startSelfPing();
    
    // Do an immediate health check
    setTimeout(async () => {
      try {
        const response = await fetch(`http://localhost:${PORT}/health`);
        const healthData = await response.json();
        logger.logInfo('startup', `Initial health check - Status: ${healthData.status}`);
      } catch (error) {
        logger.logError('startup', 'Initial health check failed', error instanceof Error ? error.message : String(error));
      }
    }, 2000); // Initial check after 2 seconds
  }, 10000); // Start after 10 seconds
}); 