export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
export const WS_URL = process.env.SOLANA_WS_URL || 'wss://api.devnet.solana.com';
export const NETWORK = 'devnet';
export const TARGET_WALLET_ADDRESS = process.env.TARGET_WALLET_ADDRESS || '';
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';
export const TRANSACTION_CONFIG = {
    maxSlippage: 0.20,
    priorityFee: 100000,
    maxRetries: 3,
    timeout: 30000,
    minSolBalance: 0.01,
    maxSolPerTrade: 5,
};
export const DEX_CONFIG = {
    jupiterApiUrl: 'https://quote-api.jup.ag/v6',
    minLiquidity: 1000,
    maxPriceImpact: 5,
    trustedDexes: ['RAYDIUM', 'ORCA', 'JUPITER']
};
export const MONITORING_CONFIG = {
    wsReconnectInterval: 50000,
    maxWsReconnectAttempts: 10,
    logLevel: 'info',
    enableDetailedLogging: true,
};
export const SAFETY_CONFIG = {
    maxTradesPerHour: 2,
    tradeCooldown: 60000, // 1 minute
    maxDailyTradeValue: 1,
    blacklistedTokens: [],
    enableEmergencyStop: true
};
