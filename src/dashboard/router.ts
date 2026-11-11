import { timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response, Router } from "express";
import { getConfig } from "../config.js";
import { getLogs, subscribe } from "../logs.js";
import { getConnection } from "../rpc.js";
import { getHoldings } from "./holdings.js";
import { dashboardPage } from "./page.js";

const BALANCE_CACHE_MS = 5_000;
const SSE_HEARTBEAT_MS = 25_000;
const SSE_BACKLOG = 500;
const startedAt = Date.now();

let balanceCache: { at: number; value: Promise<number> } | undefined;

/** Our wallet's SOL balance in lamports, cached briefly so page refreshes don't hammer the RPC. */
function getBalanceLamports(): Promise<number> {
  if (!balanceCache || Date.now() - balanceCache.at > BALANCE_CACHE_MS) {
    const config = getConfig();
    const value = getConnection(config.rpcUrl).getBalance(config.wallet.publicKey, "confirmed");
    value.catch(() => (balanceCache = undefined));
    balanceCache = { at: Date.now(), value };
  }
  return balanceCache.value;
}

export function resetBalanceCache(): void {
  balanceCache = undefined;
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireToken(req: Request, res: Response, next: NextFunction): void {
  const expected = getConfig().dashboardToken;
  if (!expected) return next();

  const header = req.get("authorization");
  const given =
    (typeof req.query.token === "string" ? req.query.token : undefined) ??
    (header?.startsWith("Bearer ") ? header.slice(7) : undefined);

  if (given && tokenMatches(given, expected)) return next();
  res.status(401).type("text/plain").send("Unauthorized: open /dashboard?token=<DASHBOARD_TOKEN>");
}

export function createDashboardRouter(): Router {
  const router = Router();
  router.use(requireToken);

  router.get("/", (_req, res) => {
    res.type("html").set("Cache-Control", "no-store").send(dashboardPage);
  });

  router.get("/api/status", async (_req, res) => {
    const config = getConfig();
    let balanceLamports: number | null = null;
    let balanceError: string | null = null;
    try {
      balanceLamports = await getBalanceLamports();
    } catch (err) {
      balanceError = err instanceof Error ? err.message : String(err);
    }

    res.set("Cache-Control", "no-store").json({
      wallet: config.wallet.publicKey.toBase58(),
      targetWallet: config.targetWallet,
      balanceLamports,
      balanceError,
      dryRun: config.dryRun,
      buyAmountLamports: config.buyAmountLamports,
      slippagePercent: config.slippagePercent,
      maxPriceIncreasePercent: config.maxPriceIncreasePercent,
      priorityFeeLamports: config.priorityFeeLamports,
      startedAt,
    });
  });

  router.get("/api/holdings", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store").json(await getHoldings(getConfig()));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/logs", (req, res) => {
    const after = Number(req.query.after ?? 0) || 0;
    res.set("Cache-Control", "no-store").json(getLogs(after, SSE_BACKLOG));
  });

  // Server-Sent Events: backlog first, then live entries. On reconnect the
  // browser sends Last-Event-ID, so only entries it missed are replayed.
  router.get("/api/logs/stream", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const send = (entry: { id: number }) => {
      res.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`);
    };

    const lastId = Number(req.get("last-event-id") ?? 0) || 0;
    for (const entry of getLogs(lastId, SSE_BACKLOG)) send(entry);

    const unsubscribe = subscribe(send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), SSE_HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
