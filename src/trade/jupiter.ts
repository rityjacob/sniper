import { VersionedTransaction } from "@solana/web3.js";
import { WRAPPED_SOL_MINT } from "../swap-processor.js";
import type { BuyContext, VenueQuote } from "./types.js";

async function fetchWithRetries(
  url: string,
  init: RequestInit,
  label: string,
  retries = 2
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      const cause = err instanceof Error && err.cause ? ` (cause: ${String(err.cause)})` : "";
      const message = err instanceof Error ? err.message + cause : String(err);
      console.error(`[Jupiter] ${label} fetch failed (attempt ${attempt + 1}/${retries + 1}):`, message);
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

/** Buy through the Jupiter aggregator (Raydium, Meteora, Orca, ...). */
export async function quoteJupiter(ctx: BuyContext): Promise<VenueQuote> {
  const { config, wallet, mint, decimals, lamports } = ctx;
  const headers: Record<string, string> = { "User-Agent": "sniper-copy-trade/1.0" };
  if (config.jupiterApiKey) headers["x-api-key"] = config.jupiterApiKey;

  const quoteUrl = new URL(`${config.jupiterApiUrl}/swap/v1/quote`);
  quoteUrl.searchParams.set("inputMint", WRAPPED_SOL_MINT);
  quoteUrl.searchParams.set("outputMint", mint.toBase58());
  quoteUrl.searchParams.set("amount", lamports.toString());
  quoteUrl.searchParams.set("slippageBps", Math.round(config.slippagePercent * 100).toString());

  const quoteRes = await fetchWithRetries(quoteUrl.toString(), { headers }, "quote");
  if (!quoteRes.ok) {
    throw new Error(`Jupiter quote failed: ${quoteRes.status} ${await quoteRes.text()}`);
  }
  const quoteResponse = (await quoteRes.json()) as { outAmount?: string };
  if (!quoteResponse.outAmount) throw new Error("Jupiter quote has no outAmount (no route?)");

  return {
    venue: "jupiter",
    expectedTokens: Number(quoteResponse.outAmount) / 10 ** decimals,
    async buildTransaction() {
      const swapRes = await fetchWithRetries(
        `${config.jupiterApiUrl}/swap/v1/swap`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                priorityLevel: "veryHigh",
                maxLamports: config.priorityFeeLamports,
                global: false,
              },
            },
          }),
        },
        "swap build"
      );
      if (!swapRes.ok) {
        throw new Error(`Jupiter swap build failed: ${swapRes.status} ${await swapRes.text()}`);
      }
      const { swapTransaction } = (await swapRes.json()) as { swapTransaction?: string };
      if (!swapTransaction) throw new Error("Jupiter swap build returned no transaction");

      const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
      tx.sign([wallet]);
      return tx;
    },
  };
}
