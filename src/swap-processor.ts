import type { HeliusTransactionEvent, TokenTransfer } from "./types/helius.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export type SwapSide = "BUY" | "SELL";

export interface SwapSummary {
  signature: string;
  type: string;
  source: string;
  slot: number;
  feePayer: string;
  tokenTransfers: TokenTransfer[];
  nativeTransfers: { amount: number; fromUserAccount: string; toUserAccount: string }[];
  mint: string | null;
  side: SwapSide;
}

function getTradedTokenMint(tx: HeliusTransactionEvent): string | null {
  const transfers = tx.tokenTransfers ?? [];
  const nonSolTransfer = transfers.find((t) => t.mint !== WRAPPED_SOL_MINT);
  return nonSolTransfer?.mint ?? null;
}

export function getSwapSide(tx: HeliusTransactionEvent): SwapSide {
  const feePayer = tx.feePayer;
  const transfers = tx.tokenTransfers ?? [];

  if (!feePayer) return "BUY"; // fallback

  const nonSolTransfer = transfers.find((t) => t.mint !== WRAPPED_SOL_MINT);
  if (!nonSolTransfer) return "BUY";

  if (nonSolTransfer.toUserAccount === feePayer) return "BUY";
  if (nonSolTransfer.fromUserAccount === feePayer) return "SELL";

  return "BUY"; // fallback
}

export function processSwapTransaction(tx: HeliusTransactionEvent): SwapSummary | null {
  if (tx.type !== "SWAP") return null;

  const side = getSwapSide(tx);
  const mint = getTradedTokenMint(tx);

  return {
    signature: tx.signature ?? "",
    type: tx.type ?? "",
    source: tx.source ?? "",
    slot: tx.slot ?? 0,
    feePayer: tx.feePayer ?? "",
    tokenTransfers: tx.tokenTransfers ?? [],
    nativeTransfers: tx.nativeTransfers ?? [],
    mint,
    side,
  };
}

export function onBuyTransaction(): void {
  console.log("Buy triggered");
}
