import { PublicKey } from "@solana/web3.js";
import type { Config } from "../config.js";
import { getConnection } from "../rpc.js";
import { WRAPPED_SOL_MINT } from "../swap-processor.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const HOLDINGS_CACHE_MS = 15_000;
const PRICE_BATCH = 50; // Jupiter Price API v3 limit per request
const TOKEN_INFO_BATCH = 100; // Jupiter Tokens API v2 search limit per request
const FETCH_TIMEOUT_MS = 8_000;

export interface Holding {
  mint: string;
  amount: number;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  priceUsd: number | null;
  valueUsd: number | null;
  valueSol: number | null;
}

export interface Holdings {
  tokens: Holding[];
  solPriceUsd: number | null;
  totalValueUsd: number;
  totalValueSol: number | null;
  /** Set when prices or token info couldn't be fetched; balances are still shown. */
  priceError: string | null;
  updatedAt: number;
}

interface TokenInfo {
  symbol: string | null;
  name: string | null;
  icon: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function jupiterHeaders(config: Config): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "sniper-copy-trade/1.0" };
  if (config.jupiterApiKey) headers["x-api-key"] = config.jupiterApiKey;
  return headers;
}

async function getJson(url: string, config: Config): Promise<unknown> {
  const res = await fetch(url, { headers: jupiterHeaders(config), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).pathname} returned HTTP ${res.status}`);
  return res.json();
}

/** Non-zero token balances of `owner`, summed per mint, across SPL Token and Token-2022. */
export async function fetchBalances(config: Config): Promise<Map<string, number>> {
  const conn = getConnection(config.rpcUrl);
  const owner = config.wallet.publicKey;
  const results = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed")
    )
  );

  const balances = new Map<string, number>();
  for (const { value } of results) {
    for (const { account } of value) {
      const info = account.data.parsed?.info;
      const mint: string | undefined = info?.mint;
      const amount = Number(info?.tokenAmount?.uiAmountString ?? 0);
      if (!mint || mint === WRAPPED_SOL_MINT || !(amount > 0)) continue;
      balances.set(mint, (balances.get(mint) ?? 0) + amount);
    }
  }
  return balances;
}

/** USD price per mint from Jupiter's Price API. Mints without a price are left out. */
export async function fetchPrices(mints: string[], config: Config): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  for (const ids of chunk(mints, PRICE_BATCH)) {
    const data = (await getJson(`${config.jupiterApiUrl}/price/v3?ids=${ids.join(",")}`, config)) as Record<
      string,
      { usdPrice?: number } | null
    >;
    for (const [mint, entry] of Object.entries(data ?? {})) {
      if (typeof entry?.usdPrice === "number" && Number.isFinite(entry.usdPrice)) prices.set(mint, entry.usdPrice);
    }
  }
  return prices;
}

async function fetchTokenInfo(mints: string[], config: Config): Promise<Map<string, TokenInfo>> {
  const infos = new Map<string, TokenInfo>();
  for (const ids of chunk(mints, TOKEN_INFO_BATCH)) {
    const data = (await getJson(
      `${config.jupiterApiUrl}/tokens/v2/search?query=${ids.join(",")}`,
      config
    )) as Array<{ id?: string; symbol?: string; name?: string; icon?: string }>;
    for (const t of Array.isArray(data) ? data : []) {
      if (!t.id) continue;
      infos.set(t.id, {
        symbol: t.symbol ?? null,
        name: t.name ?? null,
        // Only plain http(s) images; anything else is dropped.
        icon: t.icon && /^https?:\/\//.test(t.icon) ? t.icon : null,
      });
    }
  }
  return infos;
}

export async function loadHoldings(config: Config): Promise<Holdings> {
  const balances = await fetchBalances(config);
  const mints = [...balances.keys()];

  let prices = new Map<string, number>();
  let infos = new Map<string, TokenInfo>();
  let priceError: string | null = null;
  const [priceResult, infoResult] = await Promise.allSettled([
    fetchPrices([WRAPPED_SOL_MINT, ...mints], config),
    mints.length ? fetchTokenInfo(mints, config) : Promise.resolve(new Map<string, TokenInfo>()),
  ]);
  if (priceResult.status === "fulfilled") prices = priceResult.value;
  else priceError = `Prices unavailable: ${String(priceResult.reason?.message ?? priceResult.reason)}`;
  if (infoResult.status === "fulfilled") infos = infoResult.value;
  else priceError ??= `Token info unavailable: ${String(infoResult.reason?.message ?? infoResult.reason)}`;

  const solPriceUsd = prices.get(WRAPPED_SOL_MINT) ?? null;
  const tokens: Holding[] = mints.map((mint) => {
    const amount = balances.get(mint)!;
    const priceUsd = prices.get(mint) ?? null;
    const valueUsd = priceUsd === null ? null : amount * priceUsd;
    const info = infos.get(mint);
    return {
      mint,
      amount,
      symbol: info?.symbol ?? null,
      name: info?.name ?? null,
      icon: info?.icon ?? null,
      priceUsd,
      valueUsd,
      valueSol: valueUsd !== null && solPriceUsd ? valueUsd / solPriceUsd : null,
    };
  });

  // Most valuable first; unpriced tokens last.
  tokens.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const totalValueUsd = tokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);

  return {
    tokens,
    solPriceUsd,
    totalValueUsd,
    totalValueSol: solPriceUsd ? totalValueUsd / solPriceUsd : null,
    priceError,
    updatedAt: Date.now(),
  };
}

let cache: { at: number; value: Promise<Holdings> } | undefined;

/** Holdings, cached briefly so several open dashboards don't multiply RPC/API calls. */
export function getHoldings(config: Config): Promise<Holdings> {
  if (!cache || Date.now() - cache.at > HOLDINGS_CACHE_MS) {
    const value = loadHoldings(config);
    value.catch(() => (cache = undefined));
    cache = { at: Date.now(), value };
  }
  return cache.value;
}

export function resetHoldingsCache(): void {
  cache = undefined;
}
