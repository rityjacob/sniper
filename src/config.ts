import * as dotenv from 'dotenv';
dotenv.config();

export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS || '';
export const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET || '';

// Pump.fun configuration
export const PUMP_FUN_PROGRAM_ID = 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Trading configuration
export const DEFAULT_SLIPPAGE = 0.25; // 1%
export const MAX_RETRIES = 3;
export const MIN_SOL_BALANCE = 0.001; // Minimum SOL to keep in wallet