/**
 * Copy Trading Bot Server - No SDK dependencies
 * Uses direct Helius RPC calls for all blockchain interactions
 */

import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

// Import our custom utilities
import { rpcClient } from './rpc-client';
import { createKeypairFromSecretKey, pubkeyToBase58, base58ToPubkey } from './crypto-utils';
import {
  createTransaction,
  addInstruction,
  createComputeUnitLimitInstruction,
  createComputeUnitPriceInstruction,
  setTransactionBlockhash,
  signTransaction,
  serializeTransaction
} from './transaction-builder';
import {
  getOrCreateAssociatedTokenAccount
} from './spl-token';
import {
  buildPumpBuyTransaction
} from './pump-fun';
import {
  RPC_URL,
  TARGET_WALLET_ADDRESS,
  WALLET_PRIVATE_KEY,
  FIXED_SOL_PER_TRADE,
  SLIPPAGE_BPS,
  COMPUTE_UNIT_LIMIT,
  MIN_SOL_BALANCE,
  PORT
} from './config';
import BN from 'bn.js';

// Initialize Express app
const app = express();

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(helmet());

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many webhook requests from this IP, please try again later.',
});

// Initialize bot wallet
const botKeypair = createKeypairFromSecretKey(WALLET_PRIVATE_KEY);
const botWalletPubkey = pubkeyToBase58(botKeypair.publicKey);

console.log('🚀 Copy Trading Bot Started (No SDK)');
console.log('🎯 Target wallet:', TARGET_WALLET_ADDRESS);
console.log('🤖 Bot wallet:', botWalletPubkey);
console.log('💰 Fixed buy amount:', FIXED_SOL_PER_TRADE, 'SOL');
console.log('📡 RPC URL:', RPC_URL);

// Webhook endpoint for Helius
app.post('/webhook', webhookLimiter, async (req: Request, res: Response) => {
  console.log('\n🔔 === WEBHOOK RECEIVED ===');
  console.log('📅 Timestamp:', new Date().toISOString());
  
  // Respond quickly to Helius
  res.status(200).json({
    success: true,
    message: 'Webhook received',
    timestamp: new Date().toISOString()
  });

  // Process webhook asynchronously
  processWebhookAsync(req.body).catch(error => {
    console.error('❌ Webhook processing error:', error);
  });
});

// Process webhook data
async function processWebhookAsync(webhookData: any) {
  try {
    console.log('🔍 Processing webhook data...');
    
    // Handle array of transactions (Helius sends array with one transaction)
    const transaction = Array.isArray(webhookData) ? webhookData[0] : webhookData;
    
    // Extract transaction data
    const tokenTransfers = transaction.tokenTransfers || [];
    const nativeTransfers = transaction.nativeTransfers || [];
    
    console.log(`📊 Found ${tokenTransfers.length} token transfers, ${nativeTransfers.length} native transfers`);
    
    // Check if target wallet is involved
    if (!isTargetWalletInvolved(tokenTransfers, nativeTransfers)) {
      console.log('❌ Target wallet not involved in this transaction');
      return;
    }
    
    console.log('✅ Target wallet involved - analyzing transaction...');
    
    // Detect buy transaction
    const buyInfo = detectBuyTransaction(tokenTransfers, nativeTransfers);
    
    if (!buyInfo.isBuy) {
      console.log('❌ Not a buy transaction - skipping');
      return;
    }
    
    console.log('🟢 BUY TRANSACTION DETECTED!');
    console.log(`   Token: ${buyInfo.tokenMint}`);
    console.log(`   Target spent: ${buyInfo.solAmount} SOL`);
    console.log(`   Bot will buy: ${FIXED_SOL_PER_TRADE} SOL (fixed amount)`);
    
    // Execute copy trade
    await executeCopyTrade(buyInfo.tokenMint);
    
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
  }
}

// Check if target wallet is involved in the transaction
function isTargetWalletInvolved(tokenTransfers: any[], nativeTransfers: any[]): boolean {
  const targetWallet = TARGET_WALLET_ADDRESS;
  
  // Check token transfers
  const targetInTokenTransfers = tokenTransfers.some(transfer => 
    transfer.fromUserAccount === targetWallet || 
    transfer.toUserAccount === targetWallet
  );
  
  // Check native transfers (SOL)
  const targetInNativeTransfers = nativeTransfers.some(transfer => 
    transfer.fromUserAccount === targetWallet || 
    transfer.toUserAccount === targetWallet
  );
  
  return targetInTokenTransfers || targetInNativeTransfers;
}

// Detect if this is a buy transaction
function detectBuyTransaction(tokenTransfers: any[], nativeTransfers: any[]): {
  isBuy: boolean;
  tokenMint: string;
  solAmount: number;
} {
  const targetWallet = TARGET_WALLET_ADDRESS;
  
  // Look for token transfers where target wallet is receiving tokens
  const targetReceivingTokens = tokenTransfers.find(transfer => 
    transfer.toUserAccount === targetWallet
  );
  
  // Look for SOL transfers where target wallet is sending SOL
  const targetSendingSol = nativeTransfers.find(transfer => 
    transfer.fromUserAccount === targetWallet
  );
  
  if (targetReceivingTokens && targetSendingSol) {
    // This looks like a buy: target sent SOL and received tokens
    const solAmount = targetSendingSol.amount / 1e9; // Convert lamports to SOL
    
    return {
      isBuy: true,
      tokenMint: targetReceivingTokens.mint,
      solAmount: solAmount
    };
  }
  
  return {
    isBuy: false,
    tokenMint: '',
    solAmount: 0
  };
}

// Get dynamic priority fees
async function getDynamicPriorityFees(): Promise<number> {
  try {
    const recentFees = await rpcClient.getRecentPrioritizationFees([botWalletPubkey]);

    if (!recentFees || recentFees.length === 0) {
      console.log('⚠️ No recent prioritization fees found, using default');
      return 1000;
    }

    // Calculate median fee per CU
    const feesPerCu = recentFees.map(fee => {
      const cuLimit = 200000; // Default CU limit
      return fee.prioritizationFee / cuLimit;
    });
    feesPerCu.sort((a, b) => a - b);
    
    const medianFeePerCu = feesPerCu[Math.floor(feesPerCu.length / 2)];
    
    // Add 10% above median for competitive pricing
    const competitiveMultiplier = 1.1;
    const dynamicComputeUnitPrice = Math.max(
      Math.floor(medianFeePerCu * competitiveMultiplier),
      1000 // Never go below minimum
    );

    console.log(`📊 Dynamic Priority Fee: Median=${medianFeePerCu.toFixed(0)}, CU Price=${dynamicComputeUnitPrice}`);
    
    return dynamicComputeUnitPrice;
    
  } catch (error) {
    console.log('⚠️ Failed to get dynamic priority fees, using default:', error);
    return 1000;
  }
}

// Execute copy trade using Pump.fun
async function executeCopyTrade(tokenMint: string) {
  try {
    console.log(`🚀 Executing copy trade: ${FIXED_SOL_PER_TRADE} SOL for token ${tokenMint}`);
    
    // Get current balance
    const currentBalance = await rpcClient.getBalance(botWalletPubkey);
    const currentBalanceSol = currentBalance / 1e9;
    
    console.log(`💰 Current balance: ${currentBalanceSol.toFixed(6)} SOL`);
    
    // Check minimum balance
    if (currentBalanceSol < MIN_SOL_BALANCE) {
      throw new Error(`INSUFFICIENT BALANCE: Need at least ${MIN_SOL_BALANCE} SOL, but only have ${currentBalanceSol.toFixed(6)} SOL`);
    }
    
    // Use fixed SOL amount
    const tradeAmountSol = FIXED_SOL_PER_TRADE;
    const tradeAmountLamports = Math.floor(tradeAmountSol * 1e9);
    const tradeAmountBN = new BN(tradeAmountLamports);
    
    console.log(`💵 Trade amount: ${tradeAmountSol.toFixed(6)} SOL (${tradeAmountLamports} lamports)`);
    
    // Convert token mint to bytes
    const tokenMintBytes = base58ToPubkey(tokenMint);
    
    // Get or create associated token account
    console.log('🔍 Checking/creating token account...');
    const { address: tokenAccount, createInstruction } = await getOrCreateAssociatedTokenAccount(
      tokenMintBytes,
      botKeypair.publicKey,
      botKeypair.publicKey
    );
    
    console.log(`✅ Token account: ${pubkeyToBase58(tokenAccount)}`);
    
    // Create transaction
    const tx = createTransaction();
    tx.feePayer = botKeypair.publicKey;
    
    // Add compute budget instructions
    const dynamicPrice = await getDynamicPriorityFees();
    addInstruction(tx, createComputeUnitLimitInstruction(COMPUTE_UNIT_LIMIT));
    addInstruction(tx, createComputeUnitPriceInstruction(dynamicPrice));
    
    // Add token account creation if needed
    if (createInstruction) {
      console.log('🏗️ Adding token account creation instruction...');
      addInstruction(tx, createInstruction);
    }
    
    // Build Pump.fun buy instruction
    console.log('🔧 Building Pump.fun buy instruction...');
    const buyInstruction = await buildPumpBuyTransaction(
      botKeypair.publicKey,
      tokenMintBytes,
      tokenAccount,
      tradeAmountBN,
      SLIPPAGE_BPS
    );
    
    addInstruction(tx, buyInstruction);
    
    // Set blockhash and sign
    console.log('📝 Setting blockhash and signing transaction...');
    await setTransactionBlockhash(tx, 'finalized');
    signTransaction(tx, botKeypair);
    
    // Serialize transaction
    const serializedTx = serializeTransaction(tx);
    
    console.log('📤 Sending transaction...');
    const signature = await rpcClient.sendTransaction(serializedTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3
    });
    
    console.log('✅ Transaction sent:', signature);
    
    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...');
    await confirmTransaction(signature);
    
    console.log('🎉 Copy trade completed successfully!');
    console.log(`   Signature: ${signature}`);
    console.log(`   Token: ${tokenMint}`);
    console.log(`   Amount: ${tradeAmountSol} SOL`);
    
  } catch (error) {
    console.error('❌ Copy trade failed:', error);
    
    if (error instanceof Error) {
      const errorMessage = error.message;
      
      if (errorMessage.includes('insufficient') || errorMessage.includes('INSUFFICIENT')) {
        console.error('💸 INSUFFICIENT BALANCE: The bot wallet needs more SOL to execute trades.');
        console.error('   Please fund the bot wallet with more SOL and try again.');
      } else {
        console.error('🔧 ERROR:', errorMessage);
      }
    }
  }
}

// Confirm transaction
async function confirmTransaction(signature: string, maxAttempts: number = 30): Promise<void> {
  const startTime = Date.now();
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const status = await rpcClient.getSignatureStatus(signature);
      
      if (status && status.confirmationStatus) {
        const elapsed = Date.now() - startTime;
        console.log(`🎯 Transaction confirmed (${elapsed}ms): ${status.confirmationStatus}`);
        
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        
        return;
      }
      
      if (attempt % 5 === 0) {
        console.log(`⏳ Confirmation attempt ${attempt}/${maxAttempts}...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    botWallet: botWalletPubkey,
    targetWallet: TARGET_WALLET_ADDRESS,
    fixedBuyAmount: FIXED_SOL_PER_TRADE,
    rpcUrl: RPC_URL
  });
});

// Error handling
app.use((error: any, req: Request, res: Response, next: any) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Self-ping function to keep server awake
function startSelfPing() {
  const pingInterval = 14 * 60 * 1000; // 14 minutes
  const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || `http://localhost:${PORT}`;
  
  const pingServer = async () => {
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (response.ok) {
        console.log(`✅ Self-ping successful at ${new Date().toISOString()}`);
      } else {
        console.log(`⚠️  Self-ping failed with status: ${response.status}`);
      }
    } catch (error) {
      console.error(`❌ Self-ping error:`, error);
    }
  };

  setInterval(pingServer, pingInterval);
  pingServer(); // Initial ping
  
  console.log(`🔄 Self-ping started - pinging every ${pingInterval / 1000 / 60} minutes`);
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Copy Trading Bot running on port ${PORT}`);
  console.log(`📡 Webhook endpoint: POST /webhook`);
  console.log(`❤️  Health check: GET /health`);
  console.log(`🎯 Target wallet: ${TARGET_WALLET_ADDRESS}`);
  console.log(`🤖 Bot wallet: ${botWalletPubkey}`);
  console.log(`💰 Fixed buy amount: ${FIXED_SOL_PER_TRADE} SOL`);
  
  // Start self-ping to keep server awake
  startSelfPing();
});

export default app;
