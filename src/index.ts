import express from "express";
import { createWebhookRouter } from "./webhook.js";

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
  console.log(`Server running on port ${PORT}`);
  startKeepAlivePing();
});
