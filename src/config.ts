import dotenv from 'dotenv';
dotenv.config();

// Environment variable validation
const requiredEnvVars = [
  'TARGET_WALLET_ADDRESS',
  'WALLET_PRIVATE_KEY',
  'SOLANA_RPC_URL'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Required environment variable ${envVar} is not set. Please check your .env file or environment configuration.`);
  }
});

// Essential configuration
export const RPC_URL = process.env.SOLANA_RPC_URL!;
export const WS_URL = process.env.SOLANA_WS_URL || '';
export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS!;
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY!;

// Trading configuration
export const MIN_SOL_BALANCE = Number(process.env.MIN_SOL_BALANCE) || 0.01;
export const MAX_SOL_PER_TRADE = Number(process.env.MAX_SOL_PER_TRADE) || 0.5;
export const PERCENTAGE_OF_TARGET_TRADE = Number(process.env.PERCENTAGE_OF_TARGET_TRADE) || 50;
export const FIXED_SOL_PER_TRADE = Number(process.env.FIXED_SOL_PER_TRADE) || 0.02;
export const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS) || 5000; // 50% default

// Compute unit configuration
export const COMPUTE_UNIT_LIMIT = Number(process.env.COMPUTE_UNIT_LIMIT) || 200000;
export const COMPUTE_UNIT_PRICE = Number(process.env.COMPUTE_UNIT_PRICE) || 1000;

// Server configuration
export const PORT = Number(process.env.PORT) || 3000;

// Network configuration
export const NETWORK = 'mainnet-beta';