import { describe, it, expect } from "vitest";
import type { HeliusTransactionEvent } from "./types/helius.js";
import { getSwapSide, processSwapTransaction, isTargetWalletInvolved } from "./swap-processor.js";

const TARGET_WALLET = "gake1111111111111111111111111111111111111";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

function makePumpHeliusEvent(): HeliusTransactionEvent {
  return {
    signature: "C41CoJyZBKQ...",
    type: "SWAP",
    source: "PUMP_AMM",
    slot: 404055796,
    feePayer: TARGET_WALLET,
    tokenTransfers: [
      // WSOL out from target
      {
        mint: WRAPPED_SOL_MINT,
        fromUserAccount: TARGET_WALLET,
        toUserAccount: "PumpMarket11111111111111111111111111111111",
        tokenAmount: 33.378920974,
      },
      // Meme token to target
      {
        mint: "ShapeMint11111111111111111111111111111111",
        fromUserAccount: "PumpMarket11111111111111111111111111111111",
        toUserAccount: TARGET_WALLET,
        tokenAmount: 8_926_965.101368,
      },
    ],
    nativeTransfers: [
      {
        amount: 30_000_000, // example tip
        fromUserAccount: TARGET_WALLET,
        toUserAccount: "TrojanFees11111111111111111111111111111111",
      },
    ],
  };
}

describe("swap-processor Pump AMM BUY detection", () => {
  it("detects BUY side when target receives non-SOL tokens", () => {
    const heliusEvent = makePumpHeliusEvent();
    const side = getSwapSide(heliusEvent);
    expect(side).toBe("BUY");
  });

  it("produces a SwapSummary that includes the traded mint and BUY side", () => {
    const heliusEvent = makePumpHeliusEvent();
    const summary = processSwapTransaction(heliusEvent);
    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.side).toBe("BUY");
    expect(summary.mint).toBe("ShapeMint11111111111111111111111111111111");
  });

  it("marks the target wallet as involved for Pump AMM swaps", () => {
    const heliusEvent = makePumpHeliusEvent();
    const summary = processSwapTransaction(heliusEvent);
    expect(summary).not.toBeNull();
    if (!summary) return;

    // This assertion relies on TARGET_WALLET env var matching our constant above.
    process.env.TARGET_WALLET = TARGET_WALLET;
    expect(isTargetWalletInvolved(summary)).toBe(true);
  });
});

