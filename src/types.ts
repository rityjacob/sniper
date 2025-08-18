export interface PumpFunWebhook {
    inputMint: string;
    outputMint: string;
    amount: string;
    accounts: string[];
    programId: string; // troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61
    data: string; // base64-encoded instruction
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
