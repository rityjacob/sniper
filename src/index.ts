import "dotenv/config";
import express from "express";
import { createWebhookRouter } from "./webhook.js";
import { getTraderWalletAddress, getCopyTradeConfig } from "./copy-trade.js";

const app = express();
const PORT = process.env.PORT ?? 3000;
const PING_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhook", createWebhookRouter());

function startKeepAlivePing(): void {
  const baseUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.SELF_URL;
  if (!baseUrl) {
    console.log("Keep-alive ping disabled: no RENDER_EXTERNAL_URL or SELF_URL");
    return;
  }

  const ping = async () => {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) console.log("[KeepAlive] Ping OK");
    } catch (err) {
      console.error("[KeepAlive] Ping failed:", err);
    }
  };

  setInterval(ping, PING_INTERVAL_MS);
  console.log(`Keep-alive ping started (every 14 min) -> ${baseUrl}/health`);
}

app.listen(PORT, () => {
  const traderWallet = getTraderWalletAddress();
  const targetWallet =
    process.env.TARGET_WALLET ??
    "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm";
  const { buyAmountSol, slippage } = getCopyTradeConfig();

  console.log(`Server running on port ${PORT}`);
  console.log(`Trader wallet: ${traderWallet}`);
  console.log(`Target wallet: ${targetWallet}`);
  console.log(`Buy amount: ${buyAmountSol} SOL`);
  console.log(`Slippage: ${slippage}%`);
  startKeepAlivePing();
});
