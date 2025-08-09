import dotenv from 'dotenv';
dotenv.config();

export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const WS_URL = process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com';
export const NETWORK = 'mainnet-beta';

export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS || '';
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';

interface TransactionConfig {
    maxSlippage: number;
    priorityFee: number;
    tip: number;
    maxRetries: number;
    timeout: number;
    minSolBalance: number;
    maxSolPerTrade: number;
    fixedBuyAmount: number; // Fixed SOL amount to buy for each copy trade
    computeUnitLimit: number;
    computeUnitPrice: number;
}

interface DexConfig {
    jupiterApiUrl: string;
    minLiquidity: number;
    maxPriceImpact: number;
    trustedDexes: string[];
}

interface MonitoringConfig {
    wsReconnectInterval: number;
    maxWsReconnectAttempts: number;
    logLevel: string;
    enableDetailedLogging: boolean;
}

interface SafetyConfig {
    maxTradesPerHour: number;
    tradeCooldown: number;
    maxDailyTradeValue: number;
    blacklistedTokens: string[];
    enableEmergencyStop: boolean;
}

export const TRANSACTION_CONFIG: TransactionConfig = {
    maxSlippage: 0.40, 
    priorityFee: 7000,
    tip: 500000,
    maxRetries: 3, 
    timeout: 30000,
    minSolBalance: Number(process.env.MIN_SOL_BALANCE) || 0.0001,
    maxSolPerTrade: Number(process.env.MAX_SOL_PER_TRADE) || 0.1,
    fixedBuyAmount: Number(process.env.FIXED_BUY_AMOUNT) || 0.1, 
    computeUnitLimit: 800000,
    computeUnitPrice: 600000,
};

export const DEX_CONFIG: DexConfig = {
    jupiterApiUrl: 'https://quote-api.jup.ag/v6/quote',
    minLiquidity: 1000,
    maxPriceImpact: 3,
    trustedDexes: ['RAYDIUM','ORCA','JUPITER']
};

export const MONITORING_CONFIG: MonitoringConfig = {
    wsReconnectInterval: 50000,
    maxWsReconnectAttempts: 10,
    logLevel: 'info',
    enableDetailedLogging: true,
};

export const SAFETY_CONFIG: SafetyConfig = {
    maxTradesPerHour: 3,
    tradeCooldown: 60000,
    maxDailyTradeValue: 5,
    blacklistedTokens: [],
    enableEmergencyStop: true
};