/**
 * Helius webhook payload types.
 * Enhanced format typically sends an array of transaction events.
 */
export type HeliusWebhookPayload = HeliusTransactionEvent[];

export interface HeliusTransactionEvent {
  accountData?: AccountData[];
  signature?: string;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
  slot?: number;
  blockTime?: number;
  nativeTransfers?: NativeTransfer[];
  tokenTransfers?: TokenTransfer[];
  [key: string]: unknown;
}

export interface NativeTransfer {
  amount: number;
  fromUserAccount: string;
  toUserAccount: string;
}

export interface TokenTransfer {
  mint: string;
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
  [key: string]: unknown;
}

export interface SwapSummary {
  signature: string;
  type: string;
  source: string;
  slot: number;
  feePayer: string;
  tokenTransfers: TokenTransfer[];
  nativeTransfers: { amount: number; fromUserAccount: string; toUserAccount: string }[];
  mint: string | null;
  side: "BUY" | "SELL";
}

export interface AccountData {
  account: string;
  nativeBalanceChange?: number;
  tokenBalanceChanges?: TokenBalanceChange[];
  [key: string]: unknown;
}

export interface TokenBalanceChange {
  mint: string;
  rawTokenAmount?: {
    decimals: number;
    tokenAmount: string;
  };
  tokenAccount?: string;
  userAccount?: string;
  [key: string]: unknown;
}
