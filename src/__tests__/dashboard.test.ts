import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { Express } from "express";

const WALLET = "Wa11et1111111111111111111111111111111111111";
const TARGET = "Target11111111111111111111111111111111111111";

const config: Record<string, unknown> = {};
vi.mock("../config.js", () => ({ getConfig: () => config }));

const getBalance = vi.fn();
vi.mock("../rpc.js", () => ({ getConnection: () => ({ getBalance }) }));

const { createDashboardRouter, resetBalanceCache } = await import("../dashboard/router.js");
const { addLog, resetLogs } = await import("../logs.js");

describe("dashboard", () => {
  let app: Express;

  beforeEach(() => {
    Object.assign(config, {
      wallet: { publicKey: { toBase58: () => WALLET } },
      targetWallet: TARGET,
      rpcUrl: "http://rpc",
      dryRun: true,
      buyAmountLamports: 20_000_000,
      slippagePercent: 25,
      maxPriceIncreasePercent: 25,
      priorityFeeLamports: 1_900_000,
      dashboardToken: undefined,
    });
    getBalance.mockReset().mockResolvedValue(1_500_000_000);
    resetBalanceCache();
    resetLogs();
    app = express();
    app.use("/dashboard", createDashboardRouter());
  });

  it("serves the page", async () => {
    const res = await request(app).get("/dashboard").expect(200);
    expect(res.text).toContain("<title>Sniper Dashboard</title>");
  });

  it("reports our balance and the tracked wallet", async () => {
    const res = await request(app).get("/dashboard/api/status").expect(200);
    expect(res.body).toMatchObject({
      wallet: WALLET,
      targetWallet: TARGET,
      balanceLamports: 1_500_000_000,
      balanceError: null,
      dryRun: true,
    });
  });

  it("still responds when the balance lookup fails", async () => {
    getBalance.mockRejectedValue(new Error("rpc down"));
    const res = await request(app).get("/dashboard/api/status").expect(200);
    expect(res.body.balanceLamports).toBeNull();
    expect(res.body.balanceError).toBe("rpc down");
  });

  it("returns logs after a given id", async () => {
    addLog("info", "first");
    addLog("error", "second");
    const res = await request(app).get("/dashboard/api/logs?after=1").expect(200);
    expect(res.body.map((e: { message: string }) => e.message)).toEqual(["second"]);
  });

  it("requires the token when DASHBOARD_TOKEN is set", async () => {
    config.dashboardToken = "s3cret";
    await request(app).get("/dashboard").expect(401);
    await request(app).get("/dashboard/api/status?token=wrong").expect(401);
    await request(app).get("/dashboard/api/status?token=s3cret").expect(200);
    await request(app).get("/dashboard/api/status").set("Authorization", "Bearer s3cret").expect(200);
  });
});
