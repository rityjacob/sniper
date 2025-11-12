/**
 * Pump.fun swap utilities - Manual implementation without SDK
 */

import { Instruction, AccountMeta } from './transaction-builder';
import { findProgramAddress, base58ToPubkey, pubkeyToBase58 } from './crypto-utils';
import bs58 from 'bs58';
import { rpcClient } from './rpc-client';
import BN from 'bn.js';

// Pump.fun program ID
const PUMP_FUN_PROGRAM_ID = bs58.decode('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOKEN_PROGRAM_ID = bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM_PROGRAM_ID = bs58.decode('11111111111111111111111111111111');
const RENT_SYSVAR = bs58.decode('SysvarRent111111111111111111111111111111111');

/**
 * Get canonical Pump.fun pool PDA for a token mint
 * Uses the same seeds as the Pump.fun SDK: ["pool", tokenMint]
 */
export async function getPumpPoolPDA(tokenMint: Uint8Array): Promise<Uint8Array> {
  const [poolAddress] = await findProgramAddress(
    [
      Buffer.from('pool', 'utf-8'),
      tokenMint
    ],
    PUMP_FUN_PROGRAM_ID
  );
  return poolAddress;
}

/**
 * Get pool metadata PDA
 * Note: Actual Pump.fun structure may vary - this is an approximation
 */
export async function getPoolMetadataPDA(tokenMint: Uint8Array): Promise<Uint8Array> {
  // Try common metadata PDA patterns
  try {
    const [metadataAddress] = await findProgramAddress(
      [
        Buffer.from('metadata', 'utf-8'),
        tokenMint
      ],
      PUMP_FUN_PROGRAM_ID
    );
    return metadataAddress;
  } catch {
    // Fallback: use pool PDA as metadata (some implementations use the same)
    return getPumpPoolPDA(tokenMint);
  }
}

/**
 * Get pool bonding curve PDA
 * Note: Actual Pump.fun structure may vary - this is an approximation
 */
export async function getBondingCurvePDA(tokenMint: Uint8Array): Promise<Uint8Array> {
  // Try common bonding curve PDA patterns
  try {
    const [bondingCurveAddress] = await findProgramAddress(
      [
        Buffer.from('bonding-curve', 'utf-8'),
        tokenMint
      ],
      PUMP_FUN_PROGRAM_ID
    );
    return bondingCurveAddress;
  } catch {
    // Fallback: use pool PDA
    return getPumpPoolPDA(tokenMint);
  }
}

/**
 * Fetch pool state from on-chain account
 */
export interface PoolState {
  tokenMint: Uint8Array;
  solReserves: BN;
  tokenReserves: BN;
  virtualSolReserves: BN;
  virtualTokenReserves: BN;
}

export async function getPoolState(tokenMint: Uint8Array): Promise<PoolState | null> {
  try {
    const poolPDA = await getPumpPoolPDA(tokenMint);
    const accountInfo = await rpcClient.getAccountInfo(pubkeyToBase58(poolPDA));
    
    if (!accountInfo) {
      return null;
    }

    // Decode pool state from account data
    // This is a simplified version - actual decoding depends on Pump.fun's account structure
    const data = Buffer.from(accountInfo.data[0], 'base64');
    
    // Pool state structure (simplified):
    // - tokenMint: 32 bytes (offset 8)
    // - solReserves: u64 (offset 40)
    // - tokenReserves: u64 (offset 48)
    // - virtualSolReserves: u64 (offset 56)
    // - virtualTokenReserves: u64 (offset 64)
    
    if (data.length < 72) {
      return null;
    }

    const tokenMintBytes = new Uint8Array(data.slice(8, 40));
    const solReserves = new BN(data.slice(40, 48), 'le');
    const tokenReserves = new BN(data.slice(48, 56), 'le');
    const virtualSolReserves = new BN(data.slice(56, 64), 'le');
    const virtualTokenReserves = new BN(data.slice(64, 72), 'le');

    return {
      tokenMint: tokenMintBytes,
      solReserves,
      tokenReserves,
      virtualSolReserves,
      virtualTokenReserves
    };
  } catch (error) {
    console.error('Error fetching pool state:', error);
    return null;
  }
}

/**
 * Calculate amount out for a buy (constant product formula with virtual reserves)
 */
export function calculateBuyAmountOut(
  solAmountIn: BN,
  poolState: PoolState
): BN {
  // Constant product: (virtualSolReserves + solAmountIn) * (virtualTokenReserves - tokenAmountOut) = k
  // Solving for tokenAmountOut:
  // tokenAmountOut = (virtualTokenReserves * solAmountIn) / (virtualSolReserves + solAmountIn)
  
  const virtualSolReserves = poolState.virtualSolReserves;
  const virtualTokenReserves = poolState.virtualTokenReserves;

  if (virtualSolReserves.isZero()) {
    return new BN(0);
  }

  const numerator = virtualTokenReserves.mul(solAmountIn);
  const denominator = virtualSolReserves.add(solAmountIn);
  
  return numerator.div(denominator);
}

/**
 * Calculate minimum amount out with slippage
 */
export function calculateMinAmountOut(amountOut: BN, slippageBps: number): BN {
  const slippageMultiplier = new BN(10000 - slippageBps);
  return amountOut.mul(slippageMultiplier).div(new BN(10000));
}

/**
 * Create buy instruction for Pump.fun
 * Instruction discriminator: 1 (buy)
 */
export async function createPumpBuyInstruction(
  user: Uint8Array,
  tokenMint: Uint8Array,
  userTokenAccount: Uint8Array,
  solAmount: BN,
  minTokensOut: BN
): Promise<Instruction> {
  const poolPDA = await getPumpPoolPDA(tokenMint);
  const metadataPDA = await getPoolMetadataPDA(tokenMint);
  const bondingCurvePDA = await getBondingCurvePDA(tokenMint);

  // Instruction discriminator: 1 (buy)
  const data = Buffer.allocUnsafe(1 + 8 + 8);
  data.writeUInt8(1, 0); // Buy instruction
  data.writeBigUInt64LE(BigInt(solAmount.toString()), 1); // Sol amount in
  data.writeBigUInt64LE(BigInt(minTokensOut.toString()), 9); // Min tokens out

  const keys: AccountMeta[] = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolPDA, isSigner: false, isWritable: true },
    { pubkey: metadataPDA, isSigner: false, isWritable: true },
    { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  ];

  return {
    programId: PUMP_FUN_PROGRAM_ID,
    keys,
    data: new Uint8Array(data)
  };
}

/**
 * Build complete buy transaction for Pump.fun
 */
export async function buildPumpBuyTransaction(
  user: Uint8Array,
  tokenMint: Uint8Array,
  userTokenAccount: Uint8Array,
  solAmount: BN,
  slippageBps: number = 5000 // 50% default slippage
): Promise<Instruction> {
  // Get pool state
  const poolState = await getPoolState(tokenMint);
  if (!poolState) {
    throw new Error('Pool not found or invalid');
  }

  // Calculate expected tokens out
  const tokensOut = calculateBuyAmountOut(solAmount, poolState);
  const minTokensOut = calculateMinAmountOut(tokensOut, slippageBps);

  console.log(`📊 Pool state:`);
  console.log(`   SOL reserves: ${poolState.solReserves.toString()}`);
  console.log(`   Token reserves: ${poolState.tokenReserves.toString()}`);
  console.log(`   Virtual SOL: ${poolState.virtualSolReserves.toString()}`);
  console.log(`   Virtual Token: ${poolState.virtualTokenReserves.toString()}`);
  console.log(`💰 Expected tokens out: ${tokensOut.toString()}`);
  console.log(`📉 Min tokens out (with ${slippageBps/100}% slippage): ${minTokensOut.toString()}`);

  // Create buy instruction
  return createPumpBuyInstruction(
    user,
    tokenMint,
    userTokenAccount,
    solAmount,
    minTokensOut
  );
}

