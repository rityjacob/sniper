import { describe, it, expect } from "vitest";
import { checkPrice } from "../trade/price-guard.js";

// Target paid 1 SOL for 1,000 tokens → 1,000 tokens per SOL. We spend 0.1 SOL.
const target = { solSpentLamports: 1_000_000_000, tokensReceived: 1000 };
const OUR_LAMPORTS = 100_000_000;

describe("checkPrice", () => {
  it("allows a price exactly 25% above the target's", () => {
    // 25% higher price → 100 / 1.25 = 80 tokens
    const result = checkPrice(target, OUR_LAMPORTS, 80, 25);
    expect(result?.ok).toBe(true);
    expect(result?.priceIncreasePercent).toBeCloseTo(25, 6);
  });

  it("rejects a price more than 25% above the target's", () => {
    const result = checkPrice(target, OUR_LAMPORTS, 79, 25);
    expect(result?.ok).toBe(false);
  });

  it("allows a better price than the target's", () => {
    const result = checkPrice(target, OUR_LAMPORTS, 120, 25);
    expect(result?.ok).toBe(true);
    expect(result!.priceIncreasePercent).toBeLessThan(0);
  });

  it("returns null when the target's price is unknown", () => {
    expect(checkPrice({ solSpentLamports: 0, tokensReceived: 1000 }, OUR_LAMPORTS, 80, 25)).toBeNull();
  });
});
