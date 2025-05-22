export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const WS_URL = process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com';
export const NETWORK = 'mainnet-beta';

export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS || '';
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';

interface TransactionConfig {
    maxSlippage: number;
    priorityFee: number;
    maxRetries: number;
    timeout: number;
    minSolBalance: number;
    maxSolPerTrade: number;
    percentageOfTargetTrade: number;
    maxBuyAmount: number;
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
    maxSlippage: 0.10,
    priorityFee: 30000,
    maxRetries: 5,
    timeout: 60000,
    minSolBalance: 0.01,
    maxSolPerTrade: 2,
    percentageOfTargetTrade: 0.05,
    maxBuyAmount: 5,
};

export const DEX_CONFIG: DexConfig = {
    jupiterApiUrl: 'https://quote-api.jup.ag/v6',
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
    maxTradesPerHour: 5,
    tradeCooldown: 30000,
    maxDailyTradeValue: 10,
    blacklistedTokens: [],
    enableEmergencyStop: true
};