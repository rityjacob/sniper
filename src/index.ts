import express from "express";
import { createWebhookRouter } from "./webhook.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhook", createWebhookRouter());

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
