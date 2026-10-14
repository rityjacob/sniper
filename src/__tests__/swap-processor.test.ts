import { describe, it, expect } from "vitest";
import type { HeliusTransactionEvent } from "../types/helius.js";
import { parseTargetBuy, getSolSpentLamports, WRAPPED_SOL_MINT } from "../swap-processor.js";

const TARGET = "gake1111111111111111111111111111111111111";
const POOL = "PumpMarket11111111111111111111111111111111";
const MINT = "ShapeMint11111111111111111111111111111111";

function makeTargetBuy(): HeliusTransactionEvent {
  return {
    signature: "sig-buy",
    type: "SWAP",
    source: "PUMP_AMM",
    slot: 404055796,
    fee: 5000,
    feePayer: TARGET,
    tokenTransfers: [
      { mint: WRAPPED_SOL_MINT, fromUserAccount: TARGET, toUserAccount: POOL, tokenAmount: 33.378920974 },
      { mint: MINT, fromUserAccount: POOL, toUserAccount: TARGET, tokenAmount: 8_926_965.101368 },
    ],
    nativeTransfers: [
      { amount: 28_063_385, fromUserAccount: TARGET, toUserAccount: "TrojanFees11111111111111111111111111111111" },
    ],
  };
}

describe("parseTargetBuy", () => {
  it("detects a buy by the target", () => {
    const result = parseTargetBuy(makeTargetBuy(), TARGET);
    expect("buy" in result).toBe(true);
    if (!("buy" in result)) return;
    expect(result.buy.mint).toBe(MINT);
    expect(result.buy.tokensReceived).toBeCloseTo(8_926_965.101368, 6);
    expect(result.buy.signature).toBe("sig-buy");
  });

  it("ignores non-swap events", () => {
    expect(parseTargetBuy({ ...makeTargetBuy(), type: "TRANSFER" }, TARGET)).toHaveProperty("skip");
  });

  it("ignores swaps where the target is not the fee payer", () => {
    const result = parseTargetBuy({ ...makeTargetBuy(), feePayer: "someoneElse111111111111111111111111111111" }, TARGET);
    expect(result).toEqual({ skip: "target-not-fee-payer" });
  });

  it("ignores sells", () => {
    const sell: HeliusTransactionEvent = {
      ...makeTargetBuy(),
      tokenTransfers: [
        { mint: MINT, fromUserAccount: TARGET, toUserAccount: POOL, tokenAmount: 1000 },
        { mint: WRAPPED_SOL_MINT, fromUserAccount: POOL, toUserAccount: TARGET, tokenAmount: 1 },
      ],
    };
    expect(parseTargetBuy(sell, TARGET)).toEqual({ skip: "target-sent-tokens (sell)" });
  });

  it("ignores swaps where the target received no token", () => {
    const unclear: HeliusTransactionEvent = {
      ...makeTargetBuy(),
      tokenTransfers: [{ mint: MINT, fromUserAccount: POOL, toUserAccount: "other1111111111111111111111111111111111", tokenAmount: 5 }],
    };
    expect(parseTargetBuy(unclear, TARGET)).toEqual({ skip: "no-token-received" });
  });
});

describe("getSolSpentLamports", () => {
  it("uses the target's net SOL change minus the network fee when available", () => {
    const tx: HeliusTransactionEvent = {
      ...makeTargetBuy(),
      accountData: [{ account: TARGET, nativeBalanceChange: -1_000_005_000 }],
    };
    expect(getSolSpentLamports(tx, TARGET)).toBe(1_000_000_000);
  });

  it("falls back to WSOL sent when there's no account data", () => {
    expect(getSolSpentLamports(makeTargetBuy(), TARGET)).toBe(Math.round(33.378920974 * 1e9));
  });

  it("falls back to native SOL sent when no WSOL was involved (bonding curve)", () => {
    const tx: HeliusTransactionEvent = {
      ...makeTargetBuy(),
      tokenTransfers: [{ mint: MINT, fromUserAccount: POOL, toUserAccount: TARGET, tokenAmount: 1_000_000 }],
      nativeTransfers: [{ amount: 5_000_000_000, fromUserAccount: TARGET, toUserAccount: POOL }],
    };
    expect(getSolSpentLamports(tx, TARGET)).toBe(5_000_000_000);
  });
});
