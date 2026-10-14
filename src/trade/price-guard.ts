import type { TargetBuy } from "../types/helius.js";

export interface PriceCheck {
  ok: boolean;
  /** How much more we pay per token than the target did, in percent. */
  priceIncreasePercent: number;
  minTokens: number;
  ourTokens: number;
}

/**
 * Compares our quoted fill with the target's fill.
 * Returns null when the target's price can't be derived (nothing to compare).
 */
export function checkPrice(
  target: Pick<TargetBuy, "solSpentLamports" | "tokensReceived">,
  ourLamports: number,
  ourTokens: number,
  maxPriceIncreasePercent: number
): PriceCheck | null {
  if (target.solSpentLamports <= 0 || target.tokensReceived <= 0) return null;

  const targetTokensPerLamport = target.tokensReceived / target.solSpentLamports;
  const tokensAtTargetPrice = targetTokensPerLamport * ourLamports;
  const minTokens = tokensAtTargetPrice / (1 + maxPriceIncreasePercent / 100);
  const priceIncreasePercent =
    ourTokens > 0 ? (tokensAtTargetPrice / ourTokens - 1) * 100 : Infinity;

  return {
    ok: ourTokens >= minTokens * (1 - 1e-9), // tolerate float rounding at the boundary
    priceIncreasePercent,
    minTokens,
    ourTokens,
  };
}
