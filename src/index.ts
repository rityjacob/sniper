import "dotenv/config";
import express from "express";
import { getConfig } from "./config.js";
import { createWebhookRouter } from "./webhook.js";

// Fail fast on missing/invalid env instead of on the first webhook.
const config = getConfig();

const app = express();
const PORT = process.env.PORT ?? 3000;
const PING_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes

app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhook", createWebhookRouter());

// Render's free tier sleeps after 15 min idle; pinging ourselves keeps it awake.
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
  console.log(`Server running on port ${PORT}`);
  console.log(`Trader wallet: ${config.wallet.publicKey.toBase58()}`);
  console.log(`Target wallet: ${config.targetWallet}`);
  console.log(`Buy amount: ${config.buyAmountLamports / 1e9} SOL`);
  console.log(`Slippage: ${config.slippagePercent}%`);
  console.log(`Max price above target: ${config.maxPriceIncreasePercent}%`);
  console.log(`Priority fee: ${config.priorityFeeLamports / 1e9} SOL`);
  console.log(`Jupiter API: ${config.jupiterApiUrl}`);
  if (config.dryRun) console.log("DRY_RUN enabled: transactions are simulated, not sent");
  startKeepAlivePing();
});
