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
    const amountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

    logger.logInfo('transfer', `Target wallet bought: ${tokenMint} for ${amountInSol} SOL`);

    // Execute the copy trade
    try {
      await dexManager.executeSwap(tokenMint, amountInSol);
      logger.logInfo('transfer', `Copy trade executed: Bought ${tokenMint} for ${amountInSol} SOL`);
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

app.listen(PORT, () => {
  logger.logInfo('server', `Webhook server running on port ${PORT}`);
}); 