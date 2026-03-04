import { describe, it, expect } from "vitest";
import type { SwapSummary } from "./types/helius.js";
import { getTargetBuyInfo } from "./copy-trade.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

function makeEmptySummary(): SwapSummary {
  return {
    signature: "",
    type: "SWAP",
    source: "PUMP_AMM",
    slot: 0,
    feePayer: "FEEPAYER1111111111111111111111111111111111",
    tokenTransfers: [],
    nativeTransfers: [],
    mint: "DummyMint111111111111111111111111111111111",
    side: "BUY",
  };
}

describe("getTargetBuyInfo", () => {
  it("computes SOL and tokens for a typical Pump WSOL swap (WSOL + native fees)", () => {
    const summary: SwapSummary = {
      ...makeEmptySummary(),
      feePayer: "gake1111111111111111111111111111111111111",
      tokenTransfers: [
        // WSOL spent by target (e.g. 33.378920974 WSOL)
        {
          mint: WRAPPED_SOL_MINT,
          fromUserAccount: "gake1111111111111111111111111111111111111",
          toUserAccount: "PumpMarket11111111111111111111111111111111",
          tokenAmount: 33.378920974,
        },
        // Meme token received by target (e.g. ~8.9M SHAPE)
        {
          mint: "ShapeMint11111111111111111111111111111111",
          fromUserAccount: "PumpMarket11111111111111111111111111111111",
          toUserAccount: "gake1111111111111111111111111111111111111",
          tokenAmount: 8_926_965.101368,
        },
      ],
      nativeTransfers: [
        // Example tip / fee lamports also paid by target
        {
          amount: 28063385,
          fromUserAccount: "gake1111111111111111111111111111111111111",
          toUserAccount: "TrojanFees11111111111111111111111111111111",
        },
      ],
    };

    const info = getTargetBuyInfo(summary);
    expect(info).not.toBeNull();
    if (!info) return;

    // WSOL lamports ≈ 33.378920974 * 1e9, rounded
    const expectedWsolLamports = Math.round(33.378920974 * 1e9);
    const expectedTotalLamports = expectedWsolLamports + 28_063_385;

    expect(info.solLamports).toBe(expectedTotalLamports);
    expect(info.tokensReceived).toBeCloseTo(8_926_965.101368, 6);
  });

  it("falls back correctly when only native SOL (no WSOL) is spent", () => {
    const summary: SwapSummary = {
      ...makeEmptySummary(),
      feePayer: "target11111111111111111111111111111111111",
      tokenTransfers: [
        {
          mint: "SomeToken11111111111111111111111111111111",
          fromUserAccount: "Pool1111111111111111111111111111111111111",
          toUserAccount: "target11111111111111111111111111111111111",
          tokenAmount: 1_000_000,
        },
      ],
      nativeTransfers: [
        {
          amount: 5_000_000_000, // 5 SOL
          fromUserAccount: "target11111111111111111111111111111111111",
          toUserAccount: "Pool1111111111111111111111111111111111111",
        },
      ],
    };

    const info = getTargetBuyInfo(summary);
    expect(info).not.toBeNull();
    if (!info) return;

    expect(info.solLamports).toBe(5_000_000_000);
    expect(info.tokensReceived).toBe(1_000_000);
  });
});

