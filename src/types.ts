export interface PumpFunWebhook {
    inputMint: string;
    outputMint: string;
    amount: string;
    accounts: string[];
    programId: string; // troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61
    data: string; // base64-encoded instruction
    source?: string; // PUMP_AMM, etc.
    signature?: string;
    slot?: number;
    blockTime?: number;
    timestamp?: number;
    feePayer?: string; // Fee payer of the transaction
    // Enhanced transaction payload
    transaction?: {
        signature: string;
        slot: number;
        blockTime: number;
        meta: {
            err: any;
            fee: number;
            preBalances: number[];
            postBalances: number[];
            preTokenBalances: any[];
            postTokenBalances: any[];
            logMessages: string[];
        };
        transaction: {
            message: {
                accountKeys: string[];
                instructions: any[];
            };
        };
    };
    leaderWallet?: string; // Target wallet address
    tokenMint?: string; // Token mint received
    poolAddress?: string; // Pool address if available
}

// New types for Pump Swap SDK integration
export interface SwapCalculation {
    uiQuote: number;
    base: bigint;
    quote: bigint;
}

export interface CopyTradeParams {
    tokenMint: string;
    poolKey: string;
    leaderWallet: string;
    buyAmount: number; // SOL amount to spend
    slippage: number;
    isBuy: boolean; // true for buy, false for sell
}

export interface PumpFunSwapParams {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    accounts: string[];
    instructionData: Buffer;
}

export interface SwapResult {
    signature: string;
    success: boolean;
    error?: string;
}

export interface TokenBalance {
    mint: string;
    balance: number;
    decimals: number;
}
