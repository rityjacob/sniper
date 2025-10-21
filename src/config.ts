import dotenv from 'dotenv';
dotenv.config();

// Environment variable validation
const requiredEnvVars = [
  'TARGET_WALLET_ADDRESS',
  'BOT_WALLET_SECRET', 
  'SOLANA_RPC_URL'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Required environment variable ${envVar} is not set. Please check your .env file or environment configuration.`);
  }
});

// Helius RPC endpoint (required)
export const RPC_URL = process.env.SOLANA_RPC_URL!;

// Target wallet to copy trade from
export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS!;

// Bot wallet private key
export const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET!;
export const WALLET_PRIVATE_KEY = process.env.BOT_WALLET_SECRET!; // Alias for compatibility

// Fixed SOL amount per trade (can be overridden via environment)
export const FIXED_SOL_PER_TRADE = Number(process.env.FIXED_SOL_PER_TRADE) || 0.02;

// Slippage tolerance in basis points (default 50%)
export const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS) || 5000;

// Self-ping interval in minutes (fixed at 14 minutes)
export const SELF_PING_INTERVAL_MINUTES = 14;

// Network configuration
export const NETWORK = 'mainnet-beta';

// Transaction configuration for compatibility
export const TRANSACTION_CONFIG = {
    maxSlippage: 0.25,
    priorityFee: 1000000,
    tip: 500000,
    maxRetries: 2,
    timeout: 10000,
    minSolBalance: 0.0001,
    maxSolPerTrade: 0.1,
    percentageOfTargetTrade: 1,
    maxBuyAmount: 1,
    computeUnitLimit: 200000,
    computeUnitPrice: 10000,
};