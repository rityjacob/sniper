import { Router, Request, Response } from "express";
import type { HeliusTransactionEvent } from "./types/helius.js";
import { processSwapTransaction, onBuyTransaction, shouldCopyBuy } from "./swap-processor.js";

export function createWebhookRouter(): Router {
  const router = Router();

  router.post("/helius", (req: Request, res: Response) => {
    const content = req.body;

    if (
      content === undefined ||
      content === null ||
      (typeof content === "object" && !Array.isArray(content) && Object.keys(content).length === 0)
    ) {
      return res.status(400).json({
        error: "Invalid payload: body is required",
      });
    }

    const transactions: HeliusTransactionEvent[] = Array.isArray(content) ? content : [content];

    for (const tx of transactions) {
      const summary = processSwapTransaction(tx);
      if (summary) {
        console.log("[Helius SWAP]", {
          signature: summary.signature,
          type: summary.type,
          source: summary.source,
          slot: summary.slot,
          feePayer: summary.feePayer,
          tokenTransfers: summary.tokenTransfers,
          nativeTransfers: summary.nativeTransfers,
          mint: summary.mint,
          side: summary.side,
        });

        const copyDecision = shouldCopyBuy(summary);
        if (copyDecision.shouldCopy) {
          console.log("[CopyTrade] Triggering buy", {
            signature: summary.signature,
            mint: summary.mint,
            reason: copyDecision.reason,
          });
          void onBuyTransaction(summary);
        } else {
          console.log("[CopyTrade] Skipping buy", {
            signature: summary.signature,
            mint: summary.mint,
            side: summary.side,
            reason: copyDecision.reason,
            feePayer: summary.feePayer,
          });
        }
      }
    }

    const response = {
      received: true,
      content,
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(response);
  });

  return router;
}
