import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_SDK, bondingCurvePda, isSolLikeQuoteMint } from "./pump-sdk.js";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import { getConfig } from "../config.js";
import type { TargetBuy } from "../types/helius.js";
import { quoteJupiter } from "./jupiter.js";
import { checkPrice } from "./price-guard.js";
import { quotePumpAmm } from "./pump-amm.js";
import { quotePumpCurve } from "./pump-curve.js";
import { sendSigned } from "./send.js";
import type { BuyContext, Venue, VenueQuote } from "./types.js";

// Offset of the `decimals` byte in an SPL / Token-2022 mint account.
const MINT_DECIMALS_OFFSET = 44;

const venues: Record<Venue, (ctx: BuyContext) => Promise<VenueQuote>> = {
  "pump-curve": quotePumpCurve,
  "pump-amm": quotePumpAmm,
  jupiter: quoteJupiter,
};

let connection: Connection | undefined;

function getConnection(rpcUrl: string): Connection {
  connection ??= new Connection(rpcUrl, "confirmed");
  return connection;
}

/** Buys `buy.mint` with our wallet, on the same venue the token currently trades on. */
export async function executeCopyBuy(buy: TargetBuy): Promise<string> {
  const config = getConfig();
  const conn = getConnection(config.rpcUrl);
  const mint = new PublicKey(buy.mint);
  const label = `[CopyTrade ${buy.mint.slice(0, 6)}]`;

  // Fetch the blockhash while we look up the venue and quote.
  const blockhash = conn.getLatestBlockhash("confirmed");
  blockhash.catch(() => {}); // handled where it's awaited

  // One RPC call tells us the token program, decimals and where the token trades.
  const [mintInfo, curveInfo, poolInfo] = await conn.getMultipleAccountsInfo([
    mint,
    bondingCurvePda(mint),
    canonicalPumpPoolPda(mint),
  ]);
  if (!mintInfo) throw new Error(`Mint account ${buy.mint} not found`);

  const ctx: BuyContext = {
    connection: conn,
    config,
    wallet: config.wallet,
    mint,
    tokenProgram: mintInfo.owner,
    decimals: mintInfo.data[MINT_DECIMALS_OFFSET],
    lamports: config.buyAmountLamports,
    blockhash,
  };

  // Anyone can send lamports to the curve address, so an empty account doesn't mean a curve.
  const curve = curveInfo?.data.length ? PUMP_SDK.decodeBondingCurveNullable(curveInfo) : null;
  let venue: Venue;
  if (curve && !curve.complete && isSolLikeQuoteMint(curve.quoteMint)) venue = "pump-curve";
  else if (poolInfo) venue = "pump-amm";
  else venue = "jupiter";

  let quote: VenueQuote;
  try {
    quote = await venues[venue](ctx);
  } catch (err) {
    if (venue === "jupiter") throw err;
    console.warn(`${label} ${venue} quote failed, falling back to Jupiter:`, errorMessage(err));
    quote = await quoteJupiter(ctx);
  }

  const price = checkPrice(buy, ctx.lamports, quote.expectedTokens, config.maxPriceIncreasePercent);
  if (!price) {
    console.warn(`${label} target price unknown; price guard skipped (slippage still applies)`);
  } else if (!price.ok) {
    throw new Error(
      `Price is ${price.priceIncreasePercent.toFixed(1)}% above target's ` +
        `(max ${config.maxPriceIncreasePercent}%): quote ${price.ourTokens.toFixed(2)} tokens, ` +
        `need >= ${price.minTokens.toFixed(2)}. Skipping buy.`
    );
  }

  console.log(`${label} buying via ${quote.venue}`, {
    sol: ctx.lamports / 1e9,
    expectedTokens: quote.expectedTokens,
    vsTargetPricePercent: price ? Number(price.priceIncreasePercent.toFixed(2)) : null,
    slippagePercent: config.slippagePercent,
  });

  const tx = await quote.buildTransaction();
  return sendSigned(conn, tx, `${label} ${quote.venue} buy`, config.dryRun);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
