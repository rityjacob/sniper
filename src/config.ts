import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export interface Config {
  targetWallet: string;
  wallet: Keypair;
  rpcUrl: string;
  buyAmountLamports: number;
  slippagePercent: number;
  maxPriceIncreasePercent: number;
  priorityFeeLamports: number;
  jupiterApiUrl: string;
  jupiterApiKey: string | undefined;
  dryRun: boolean;
  /** When set, the dashboard requires ?token=<value>. */
  dashboardToken: string | undefined;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in environment`);
  return value;
}

export function parseSecretKey(pk: string): Keypair {
  let bytes: Uint8Array;
  if (pk.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(pk));
  } else if (pk.includes(",")) {
    bytes = Uint8Array.from(pk.split(",").map(Number));
  } else {
    bytes = bs58.decode(pk);
  }
  return Keypair.fromSecretKey(bytes);
}

export function loadConfig(): Config {
  const targetWallet = requiredEnv("TARGET_WALLET");
  // Throws if the address is malformed.
  new PublicKey(targetWallet);

  const jupiterApiKey = process.env.JUPITER_API_KEY?.trim() || undefined;

  return {
    targetWallet,
    wallet: parseSecretKey(requiredEnv("WALLET_PK")),
    rpcUrl: process.env.RPC_URL?.trim() || "https://api.mainnet-beta.solana.com",
    buyAmountLamports: Math.floor(numberEnv("BUY_AMOUNT_LAMPORTS", 20_000_000)),
    slippagePercent: numberEnv("SLIPPAGE", 25),
    maxPriceIncreasePercent: numberEnv("MAX_PRICE_INCREASE_PERCENT", 25),
    priorityFeeLamports: Math.floor(numberEnv("PRIORITY_FEE_LAMPORTS", 1_900_000)),
    jupiterApiUrl: (
      process.env.JUPITER_API_URL?.trim() ||
      (jupiterApiKey ? "https://api.jup.ag" : "https://lite-api.jup.ag")
    ).replace(/\/+$/, ""),
    jupiterApiKey,
    dryRun: (process.env.DRY_RUN ?? "").toLowerCase() === "true",
    dashboardToken: process.env.DASHBOARD_TOKEN?.trim() || undefined,
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
