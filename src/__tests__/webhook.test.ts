import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { Express } from "express";

const TARGET = "gake1111111111111111111111111111111111111";
const POOL = "Pool1111111111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";

vi.mock("../config.js", () => ({
  getConfig: () => ({ targetWallet: TARGET }),
}));

const executeCopyBuy = vi.fn().mockResolvedValue("sig");
vi.mock("../trade/index.js", () => ({
  executeCopyBuy: (...args: unknown[]) => executeCopyBuy(...args),
  errorMessage: (err: unknown) => String(err),
}));

const { createWebhookRouter } = await import("../webhook.js");
const { resetDedupe } = await import("../dedupe.js");

function targetBuy(signature: string) {
  return {
    signature,
    type: "SWAP",
    source: "PUMP_FUN",
    feePayer: TARGET,
    tokenTransfers: [
      { mint: WSOL, fromUserAccount: TARGET, toUserAccount: POOL, tokenAmount: 1 },
      { mint: "Mint11111111111111111111111111111111111111", fromUserAccount: POOL, toUserAccount: TARGET, tokenAmount: 1000 },
    ],
    nativeTransfers: [],
  };
}

describe("Helius webhook", () => {
  let app: Express;

  beforeEach(() => {
    executeCopyBuy.mockClear();
    resetDedupe();
    app = express();
    app.use(express.json());
    app.use("/webhook", createWebhookRouter());
  });

  it("copies a target buy", async () => {
    const response = await request(app).post("/webhook/helius").send([targetBuy("sig1")]).expect(200);

    expect(response.body).toEqual({ received: true, count: 1 });
    expect(executeCopyBuy).toHaveBeenCalledTimes(1);
    expect(executeCopyBuy.mock.calls[0][0]).toMatchObject({ mint: "Mint11111111111111111111111111111111111111", signature: "sig1" });
  });

  it("buys only once when Helius delivers the same signature twice", async () => {
    await request(app).post("/webhook/helius").send([targetBuy("sig1")]).expect(200);
    await request(app).post("/webhook/helius").send([targetBuy("sig1")]).expect(200);
    expect(executeCopyBuy).toHaveBeenCalledTimes(1);
  });

  it("does not copy events that aren't target buys", async () => {
    await request(app)
      .post("/webhook/helius")
      .send([{ signature: "sig2", type: "TRANSFER" }, { ...targetBuy("sig3"), feePayer: POOL }])
      .expect(200);
    expect(executeCopyBuy).not.toHaveBeenCalled();
  });

  it("returns 400 when body is empty", async () => {
    const response = await request(app).post("/webhook/helius").send().expect(400);
    expect(response.body.error).toContain("Invalid");
  });
});
