// Basic webhook data structure for Helius webhooks
export interface HeliusWebhook {
    signature: string;
    slot: number;
    timestamp: number;
    instructions: any[];
    accountData: any[];
    tokenTransfers: TokenTransfer[];
    nativeTransfers: NativeTransfer[];
}

export interface TokenTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    mint: string;
    tokenAmount: string;
}

export interface NativeTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
}

// Buy detection result
export interface BuyInfo {
    isBuy: boolean;
    tokenMint: string;
    solAmount: number;
}