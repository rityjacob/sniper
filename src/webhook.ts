import { Router, Request, Response } from "express";
import type { HeliusTransactionEvent } from "./types/helius.js";
import { getConfig } from "./config.js";
import { markIfNew } from "./dedupe.js";
import { parseTargetBuy } from "./swap-processor.js";
import { errorMessage, executeCopyBuy } from "./trade/index.js";

export function handleEvent(tx: HeliusTransactionEvent): void {
  const signature = tx.signature ?? "";
  const result = parseTargetBuy(tx, getConfig().targetWallet);

  if ("skip" in result) {
    console.log("[Webhook] skip", { signature, reason: result.skip });
    return;
  }
  // Dedupe only target buys: other events are cheap to re-skip.
  if (!signature || !markIfNew(signature)) {
    console.log("[Webhook] skip", { signature, reason: signature ? "duplicate" : "no-signature" });
    return;
  }

  const { buy } = result;
  console.log("[Webhook] target buy", {
    signature,
    mint: buy.mint,
    source: buy.source,
    targetSol: buy.solSpentLamports / 1e9,
    targetTokens: buy.tokensReceived,
  });

  // Don't block the webhook response on the trade.
  executeCopyBuy(buy).catch((err) => {
    console.error(`[CopyTrade] buy failed for ${buy.mint} (target tx ${signature}):`, errorMessage(err));
  });
}

export function createWebhookRouter(): Router {
  const router = Router();

  router.post("/helius", (req: Request, res: Response) => {
    const content = req.body;

    if (
      content === undefined ||
      content === null ||
      (typeof content === "object" && !Array.isArray(content) && Object.keys(content).length === 0)
    ) {
      return res.status(400).json({ error: "Invalid payload: body is required" });
    }

    const transactions: HeliusTransactionEvent[] = Array.isArray(content) ? content : [content];
    for (const tx of transactions) {
      try {
        handleEvent(tx);
      } catch (err) {
        console.error("[Webhook] failed to handle event:", errorMessage(err));
      }
    }

    return res.status(200).json({ received: true, count: transactions.length });
  });

  return router;
}
