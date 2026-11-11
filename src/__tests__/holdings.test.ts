import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";

const WSOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const MEME = "Meme111111111111111111111111111111111111111";
const DUST = "Dust111111111111111111111111111111111111111";

function account(mint: string, uiAmountString: string) {
  return { account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString } } } } } };
}

const getParsedTokenAccountsByOwner = vi.fn();
vi.mock("../rpc.js", () => ({ getConnection: () => ({ getParsedTokenAccountsByOwner }) }));

const { loadHoldings } = await import("../dashboard/holdings.js");

const config = {
  wallet: { publicKey: new PublicKey(WSOL) },
  rpcUrl: "http://rpc",
  jupiterApiUrl: "https://jup.test",
  jupiterApiKey: undefined,
} as never;

function mockFetch(prices: Record<string, number>, ok = true) {
  return vi.fn(async (url: string) => {
    if (!ok) return new Response("down", { status: 503 });
    if (url.includes("/price/v3")) {
      return Response.json(Object.fromEntries(Object.entries(prices).map(([m, p]) => [m, { usdPrice: p }])));
    }
    return Response.json([{ id: BONK, symbol: "BONK", name: "Bonk", icon: "javascript:alert(1)" }]);
  });
}

describe("loadHoldings", () => {
  beforeEach(() => {
    // Legacy token program: BONK split over two accounts, an empty account, and WSOL.
    // Token-2022: MEME.
    getParsedTokenAccountsByOwner
      .mockReset()
      .mockResolvedValueOnce({
        value: [account(BONK, "1000"), account(BONK, "500"), account(DUST, "0"), account(WSOL, "1")],
      })
      .mockResolvedValueOnce({ value: [account(MEME, "42")] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sums balances per mint, values them, and sorts by value", async () => {
    vi.stubGlobal("fetch", mockFetch({ [WSOL]: 100, [BONK]: 0.02 }));
    const h = await loadHoldings(config);

    expect(h.tokens.map((t) => t.mint)).toEqual([BONK, MEME]); // no WSOL, no zero balances
    expect(h.tokens[0]).toMatchObject({ amount: 1500, symbol: "BONK", valueUsd: 30, valueSol: 0.3, icon: null });
    expect(h.tokens[1]).toMatchObject({ amount: 42, priceUsd: null, valueUsd: null });
    expect(h.solPriceUsd).toBe(100);
    expect(h.totalValueUsd).toBe(30);
    expect(h.totalValueSol).toBe(0.3);
    expect(h.priceError).toBeNull();
  });

  it("still lists balances when Jupiter is down", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false));
    const h = await loadHoldings(config);

    expect(h.tokens.map((t) => [t.mint, t.amount, t.valueUsd])).toEqual([
      [BONK, 1500, null],
      [MEME, 42, null],
    ]);
    expect(h.priceError).toContain("Prices unavailable");
  });
});
