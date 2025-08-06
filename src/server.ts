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
  console.log('\n🔔 === WEBHOOK RECEIVED ===');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('📋 Event Type:', req.body.type || 'Unknown');
  console.log('🔍 Signature:', req.body.signature || 'N/A');
  console.log('📊 Payload Size:', JSON.stringify(req.body).length, 'characters');
  
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

    console.log('\n🔄 === PROCESSING SWAP EVENT ===');
    console.log('🎯 Target Wallet:', targetWallet);
    console.log('📊 Token Transfers Count:', tokenTransfers.length);
    console.log('💰 Native Transfers Count:', nativeTransfers.length);

    logger.logInfo('swap', 'Processing swap event', `Target wallet: ${targetWallet}`);

    // Find the token being bought (token that was transferred TO the target wallet)
    const buyTransfer = tokenTransfers.find((transfer: any) => {
      const isTargetReceiver = transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
      console.log(`🔍 Checking transfer: ${transfer.mint || 'Unknown'}`);
      console.log(`   To User Account: ${transfer.toUserAccount}`);
      console.log(`   To Token Account: ${transfer.toTokenAccount}`);
      console.log(`   Target Wallet: ${targetWallet}`);
      console.log(`   Is Target Receiver: ${isTargetReceiver}`);
      return isTargetReceiver;
    });

    console.log('📦 Buy Transfer Found:', !!buyTransfer);
    if (buyTransfer) {
      console.log('   Token Mint:', buyTransfer.mint);
      console.log('   Token Amount:', buyTransfer.tokenAmount);
      console.log('   To User Account:', buyTransfer.toUserAccount);
      console.log('   To Token Account:', buyTransfer.toTokenAccount);
    }

    // Get the SOL amount spent
    const solTransfersFromTarget = nativeTransfers.filter((transfer: any) => transfer.fromUserAccount === targetWallet);
    console.log('💸 SOL Transfers FROM Target:', solTransfersFromTarget.length);
    solTransfersFromTarget.forEach((transfer: any, index: number) => {
      console.log(`   ${index + 1}. Amount: ${(transfer.amount / 1e9).toFixed(6)} SOL (${transfer.amount} lamports)`);
      console.log(`      To: ${transfer.toUserAccount}`);
    });

    const totalSolSpent = solTransfersFromTarget.reduce((sum: number, transfer: any) => sum + transfer.amount, 0);
    console.log('💸 Total SOL Spent by Target:', (totalSolSpent / 1e9).toFixed(6), 'SOL');

    // Check if target wallet is buying
    if (!buyTransfer || totalSolSpent === 0) {
      console.log('❌ SWAP CONDITIONS NOT MET:');
      console.log('   - Buy Transfer Found:', !!buyTransfer);
      console.log('   - Total SOL Spent > 0:', totalSolSpent > 0);
      logger.logInfo('swap', 'Target wallet not buying in this swap');
      return;
    }

    const tokenMint = buyTransfer.mint;
    const targetAmountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

    console.log('✅ SWAP CONDITIONS MET - PROCEEDING WITH COPY TRADE');
    console.log('🎯 Token Mint:', tokenMint);
    console.log('💰 Target Amount:', targetAmountInSol.toFixed(6), 'SOL');

    // Use fixed buy amount instead of percentage calculation
    const { TRANSACTION_CONFIG } = await import('./config');
    const ourTradeAmount = TRANSACTION_CONFIG.fixedBuyAmount;
    
    console.log('📊 TRADE CALCULATION:');
    console.log('   - Target Amount:', targetAmountInSol.toFixed(6), 'SOL');
    console.log('   - Fixed Buy Amount:', ourTradeAmount.toFixed(6), 'SOL');
    console.log('   - Final Trade Amount:', ourTradeAmount.toFixed(6), 'SOL');

    logger.logInfo('swap', `Target wallet bought: ${tokenMint} for ${targetAmountInSol} SOL`);
    logger.logInfo('swap', `Fixed copy trade amount: ${ourTradeAmount} SOL`);

    // Execute the copy trade
    try {
      console.log('🚀 EXECUTING COPY TRADE...');
      console.log('   - Token:', tokenMint);
      console.log('   - Amount:', ourTradeAmount.toFixed(6), 'SOL');
      console.log('   - Compute Unit Price:', TRANSACTION_CONFIG.computeUnitPrice);
      console.log('   - Compute Unit Limit:', TRANSACTION_CONFIG.computeUnitLimit);
      
      await dexManager.executeSwap(tokenMint, ourTradeAmount);
      console.log('✅ COPY TRADE EXECUTED SUCCESSFULLY');
      logger.logInfo('swap', `Copy trade executed: Bought ${tokenMint} for ${ourTradeAmount} SOL`);
    } catch (err) {
      console.log('❌ COPY TRADE FAILED:');
      console.log('   - Error:', err instanceof Error ? err.message : String(err));
      console.log('   - Stack:', err instanceof Error ? err.stack : 'No stack trace');
      logger.logError('swap', 'Error executing copy trade', err instanceof Error ? err.message : String(err));
    }
    
    console.log('=== END SWAP PROCESSING ===\n');
  } catch (err) {
    logger.logError('swap', 'Error processing swap data', err instanceof Error ? err.message : String(err));
  }
}

async function handleTransfer(data: any) {
  try {
    const tokenTransfers = data.tokenTransfers || [];
    const nativeTransfers = data.nativeTransfers || [];
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;

    console.log('\n🔄 === PROCESSING TRANSFER EVENT ===');
    console.log('🎯 Target Wallet:', targetWallet);
    console.log('📊 Token Transfers Count:', tokenTransfers.length);
    console.log('💰 Native Transfers Count:', nativeTransfers.length);

    logger.logInfo('transfer', 'Processing transfer event', `Target wallet: ${targetWallet}`);

    // Find the token being bought (token that was transferred TO the target wallet)
    const buyTransfer = tokenTransfers.find((transfer: any) => {
      const isTargetReceiver = transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
      console.log(`🔍 Checking transfer: ${transfer.mint || 'Unknown'}`);
      console.log(`   To User Account: ${transfer.toUserAccount}`);
      console.log(`   To Token Account: ${transfer.toTokenAccount}`);
      console.log(`   Target Wallet: ${targetWallet}`);
      console.log(`   Is Target Receiver: ${isTargetReceiver}`);
      return isTargetReceiver;
    });

    console.log('📦 Buy Transfer Found:', !!buyTransfer);
    if (buyTransfer) {
      console.log('   Token Mint:', buyTransfer.mint);
      console.log('   Token Amount:', buyTransfer.tokenAmount);
      console.log('   To User Account:', buyTransfer.toUserAccount);
      console.log('   To Token Account:', buyTransfer.toTokenAccount);
    }

    // Get the SOL amount spent by target wallet
    const solTransfersFromTarget = nativeTransfers.filter((transfer: any) => transfer.fromUserAccount === targetWallet);
    console.log('💸 SOL Transfers FROM Target:', solTransfersFromTarget.length);
    solTransfersFromTarget.forEach((transfer: any, index: number) => {
      console.log(`   ${index + 1}. Amount: ${(transfer.amount / 1e9).toFixed(6)} SOL (${transfer.amount} lamports)`);
      console.log(`      To: ${transfer.toUserAccount}`);
    });

    const totalSolSpent = solTransfersFromTarget.reduce((sum: number, transfer: any) => sum + transfer.amount, 0);
    console.log('💸 Total SOL Spent by Target:', (totalSolSpent / 1e9).toFixed(6), 'SOL');

    // Check if target wallet is buying (received tokens and spent SOL)
    if (!buyTransfer || totalSolSpent === 0) {
      console.log('❌ TRANSFER CONDITIONS NOT MET:');
      console.log('   - Buy Transfer Found:', !!buyTransfer);
      console.log('   - Total SOL Spent > 0:', totalSolSpent > 0);
      logger.logInfo('transfer', 'Target wallet not buying in this transfer');
      return;
    }

    const tokenMint = buyTransfer.mint;
    const targetAmountInSol = totalSolSpent / 1e9; // Convert lamports to SOL

    // Use fixed buy amount instead of percentage calculation
    const { TRANSACTION_CONFIG } = await import('./config');
    const ourTradeAmount = TRANSACTION_CONFIG.fixedBuyAmount;

    logger.logInfo('transfer', `Target wallet bought: ${tokenMint} for ${targetAmountInSol} SOL`);
    logger.logInfo('transfer', `Fixed copy trade amount: ${ourTradeAmount} SOL`);

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

app.listen(PORT, () => {
  logger.logInfo('server', `Webhook server running on port ${PORT}`);
}); 