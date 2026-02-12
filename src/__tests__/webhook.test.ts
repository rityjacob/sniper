import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { Express } from "express";
import { createWebhookRouter } from "../webhook.js";

describe("Helius Webhook Receiver", () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/webhook", createWebhookRouter());
  });

  it("receives POST webhook and returns the payload content", async () => {
    const mockPayload = {
      signature: "5abc123...",
      type: "SWAP",
      accountData: [
        {
          account: "Wallet123",
          nativeBalanceChange: -0.01,
        },
      ],
    };

    const response = await request(app)
      .post("/webhook/helius")
      .send(mockPayload)
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body).toBeDefined();
    expect(response.body.received).toBe(true);
    expect(response.body.content).toEqual(mockPayload);
    expect(response.body.timestamp).toBeDefined();
  });

  it("handles array payload (enhanced format)", async () => {
    const mockPayload = [
      {
        signature: "sig1",
        type: "TRANSFER",
        slot: 12345,
      },
      {
        signature: "sig2",
        type: "SWAP",
        slot: 12346,
      },
    ];

    const response = await request(app)
      .post("/webhook/helius")
      .send(mockPayload)
      .expect(200);

    expect(response.body.received).toBe(true);
    expect(response.body.content).toEqual(mockPayload);
  });

  it("returns 400 when body is empty", async () => {
    const response = await request(app)
      .post("/webhook/helius")
      .send()
      .expect(400);

    expect(response.body.error).toContain("Invalid");
  });
});
