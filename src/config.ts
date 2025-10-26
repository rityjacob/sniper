import dotenv from 'dotenv';
dotenv.config();

// Environment variable validation
const requiredEnvVars = [
  'TARGET_WALLET_ADDRESS',
  'BOT_WALLET_SECRET', 
  'SOLANA_RPC_URL',
  'HELIUS_API_KEY'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Required environment variable ${envVar} is not set. Please check your .env file or environment configuration.`);
  }
});

// Essential configuration
export const RPC_URL = process.env.SOLANA_RPC_URL!;
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS!;
export const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET!;
export const WALLET_PRIVATE_KEY = process.env.BOT_WALLET_SECRET!; // Alias for compatibility

// Trading configuration
export const FIXED_SOL_PER_TRADE = Number(process.env.FIXED_SOL_PER_TRADE) || 0.02;
export const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS) || 5000;

// Compute unit configuration (use your env vars)
export const COMPUTE_UNIT_LIMIT = Number(process.env.COMPUTE_UNIT_LIMIT) || 200000;
export const COMPUTE_UNIT_PRICE = Number(process.env.COMPUTE_UNIT_PRICE) || 1000;

// Network configuration
export const NETWORK = 'mainnet-beta';

// Self-ping configuration
export const SELF_PING_INTERVAL_MINUTES = 14;