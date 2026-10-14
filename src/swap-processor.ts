import type { HeliusTransactionEvent, TargetBuy } from "./types/helius.js";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export type ParseResult = { buy: TargetBuy } | { skip: string };

/**
 * Returns the target's buy if this event is a swap where the target wallet paid
 * the fee and received a token without giving any (non-SOL) token away.
 */
export function parseTargetBuy(tx: HeliusTransactionEvent, targetWallet: string): ParseResult {
  if (tx.type !== "SWAP") return { skip: `not-a-swap (${tx.type ?? "unknown"})` };
  if (tx.feePayer !== targetWallet) return { skip: "target-not-fee-payer" };

  const tokenTransfers = tx.tokenTransfers ?? [];
  const nonSol = tokenTransfers.filter((t) => t.mint !== WRAPPED_SOL_MINT);

  if (nonSol.some((t) => t.fromUserAccount === targetWallet)) {
    return { skip: "target-sent-tokens (sell)" };
  }

  const received = nonSol.filter((t) => t.toUserAccount === targetWallet);
  if (received.length === 0) return { skip: "no-token-received" };

  const mint = received[0].mint;
  if (received.some((t) => t.mint !== mint)) return { skip: "multiple-tokens-received" };
  const tokensReceived = received.reduce((sum, t) => sum + t.tokenAmount, 0);

  return {
    buy: {
      signature: tx.signature ?? "",
      source: tx.source ?? "",
      slot: tx.slot ?? 0,
      mint,
      solSpentLamports: getSolSpentLamports(tx, targetWallet),
      tokensReceived,
    },
  };
}

/**
 * Lamports the target paid for the swap. Errs on the high side (tips, bot fees
 * and token-account rent are included), which keeps the price guard lenient.
 */
export function getSolSpentLamports(tx: HeliusTransactionEvent, targetWallet: string): number {
  // Best source: the wallet's net SOL balance change, minus the network fee.
  // It doesn't double count when SOL is wrapped to WSOL and then swapped.
  const account = tx.accountData?.find((a) => a.account === targetWallet);
  if (account?.nativeBalanceChange !== undefined && account.nativeBalanceChange < 0) {
    return Math.max(0, -account.nativeBalanceChange - (tx.fee ?? 0));
  }

  // Fallback: WSOL sent, or native SOL sent when no WSOL was involved.
  let wsolLamports = 0;
  for (const t of tx.tokenTransfers ?? []) {
    if (t.mint === WRAPPED_SOL_MINT && t.fromUserAccount === targetWallet) {
      wsolLamports += Math.round(t.tokenAmount * 1e9);
    }
  }
  let nativeLamports = 0;
  for (const n of tx.nativeTransfers ?? []) {
    if (n.fromUserAccount === targetWallet) nativeLamports += n.amount;
  }
  return wsolLamports > 0 ? wsolLamports : nativeLamports;
}
