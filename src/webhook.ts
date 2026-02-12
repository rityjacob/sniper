import { Router, Request, Response } from "express";

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

    // Display webhook content (for debugging/monitoring)
    console.log("[Helius Webhook] Received:", JSON.stringify(content, null, 2));

    const response = {
      received: true,
      content,
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(response);
  });

  return router;
}
