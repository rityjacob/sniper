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
  nativeTransfers?: unknown[];
  tokenTransfers?: unknown[];
  [key: string]: unknown;
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
