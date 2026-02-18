import type { HeliusTransactionEvent, SwapSummary, TokenTransfer } from "./types/helius.js";
import { executeCopyTrade } from "./copy-trade.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const TARGET_WALLET = process.env.TARGET_WALLET ?? "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm";

export type SwapSide = "BUY" | "SELL";
export type { SwapSummary } from "./types/helius.js";

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

export function isTargetWalletInvolved(summary: SwapSummary): boolean {
  if (summary.feePayer === TARGET_WALLET) return true;
  for (const t of summary.tokenTransfers) {
    if (t.fromUserAccount === TARGET_WALLET || t.toUserAccount === TARGET_WALLET) return true;
  }
  for (const n of summary.nativeTransfers) {
    if (n.fromUserAccount === TARGET_WALLET || n.toUserAccount === TARGET_WALLET) return true;
  }
  return false;
}

export async function onBuyTransaction(summary: SwapSummary): Promise<void> {
  try {
    await executeCopyTrade(summary);
    console.log("[CopyTrade] Buy executed successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CopyTrade] Couldn't do a copy trade:", message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }
}
