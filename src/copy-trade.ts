import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SendOptions,
  ComputeBudgetProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import {
  PumpAmmSdk,
  OnlinePumpAmmSdk,
  canonicalPumpPoolPda,
  buyQuoteInput,
} from "@pump-fun/pump-swap-sdk";
import type { SwapSummary } from "./types/helius.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

// Default: 0.02 SOL per copy trade
const DEFAULT_BUY_LAMPORTS = 20_000_000;
const DEFAULT_SLIPPAGE = 40; // 40% (SDK uses 1 = 1%)
// Price guard: allow up to 100% worse than target (0.5 = 50% of target's rate)
const DEFAULT_PRICE_GUARD_FACTOR = 0.5; // 0.5 = allow 100% worse, 0.6 = allow 40% worse, 0.75 = allow 25% worse
// Priority fee: 0.0019 SOL per trade (~130k CU → microLamports so total ≈ 0.0019 SOL)
const PRIORITY_FEE_LAMPORTS = 1_900_000; // 0.0019 SOL
const COMPUTE_UNIT_LIMIT = 200_000;

function getWalletKeypair(): Keypair {
  const pk = process.env.WALLET_PK;
  if (!pk) {
    throw new Error("WALLET_PK is not set in environment");
  }
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

function getConnection(): Connection {
  const rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  return new Connection(rpcUrl);
}

function getTargetBuyInfo(
  summary: SwapSummary
): { solLamports: number; tokensReceived: number } | null {
  const feePayer = summary.feePayer;
  let solLamports = 0;

  // SOL spent is often represented as WSOL (SPL) transfers in swap events (esp. Pump AMM).
  // We count both:
  // - WSOL outflow from the fee payer (actual swap input)
  // - native lamports outflow from the fee payer (tips/rent/fees)
  //
  // This intentionally errs on the side of being less strict to avoid false "price moved" skips.
  for (const t of summary.tokenTransfers) {
    if (t.mint === WRAPPED_SOL_MINT && t.fromUserAccount === feePayer) {
      solLamports += Math.round(t.tokenAmount * 1e9);
    }
  }

  for (const n of summary.nativeTransfers) {
    if (n.fromUserAccount === feePayer) solLamports += n.amount;
  }

  for (const t of summary.tokenTransfers) {
    if (t.mint !== WRAPPED_SOL_MINT && t.toUserAccount === feePayer) {
      return { solLamports, tokensReceived: t.tokenAmount };
    }
  }

  return solLamports > 0 ? { solLamports, tokensReceived: 0 } : null;
}

export function getTraderWalletAddress(): string {
  try {
    const wallet = getWalletKeypair();
    return wallet.publicKey.toBase58();
  } catch {
    return "not configured";
  }
}

export function getCopyTradeConfig(): {
  buyAmountSol: number;
  slippage: number;
} {
  const lamports =
    Number(process.env.BUY_AMOUNT_LAMPORTS) || DEFAULT_BUY_LAMPORTS;
  const slippage = Number(process.env.SLIPPAGE) || DEFAULT_SLIPPAGE;
  return {
    buyAmountSol: lamports / 1e9,
    slippage,
  };
}

async function confirmTransactionInBackground(
  connection: Connection,
  signature: string,
  label: string
): Promise<void> {
  const maxAttempts = 5;
  for (let i = 0; i < maxAttempts; i++) {
    const status = await connection.getSignatureStatus(signature);
    if (
      status.value?.confirmationStatus === "confirmed" ||
      status.value?.confirmationStatus === "finalized"
    ) {
      console.log(`${label} confirmed:`, signature);
      return;
    }
    if (status.value?.err) {
      console.error(`${label} failed:`, signature, status.value.err);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`${label} confirmation timeout (tx may still land):`, signature);
}

function isPumpSwap(summary: SwapSummary): boolean {
  const s = (summary.source ?? "").toLowerCase();
  return (
    s === "pump" ||
    s === "pump.fun" ||
    s.includes("pump")
  );
}

async function executeJupiterBuy(
  connection: Connection,
  wallet: Keypair,
  mint: string,
  lamports: number,
  slippagePercent: number
): Promise<string> {
  const inputMint = WRAPPED_SOL_MINT;
  const outputMint = mint;

  const slippageBps = Math.round(slippagePercent * 100);

  const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
  quoteUrl.searchParams.set("inputMint", inputMint);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", lamports.toString());
  quoteUrl.searchParams.set("slippageBps", slippageBps.toString());

  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) {
    const text = await quoteRes.text();
    throw new Error(
      `Jupiter quote failed: ${quoteRes.status} ${quoteRes.statusText} ${text}`
    );
  }
  const quoteResponse = await quoteRes.json();

  const swapRes = await fetch("https://api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: "veryHigh",
          maxLamports: PRIORITY_FEE_LAMPORTS,
          global: false,
        },
      },
    }),
  });

  if (!swapRes.ok) {
    const text = await swapRes.text();
    throw new Error(
      `Jupiter swap build failed: ${swapRes.status} ${swapRes.statusText} ${text}`
    );
  }
  const swapJson = await swapRes.json();
  const { swapTransaction } = swapJson as { swapTransaction?: string };
  if (!swapTransaction) {
    throw new Error("Jupiter swap build returned no transaction");
  }

  const rawTx = Buffer.from(swapTransaction, "base64");
  const jupTx = VersionedTransaction.deserialize(rawTx);
  jupTx.sign([wallet]);

  const signature = await connection.sendRawTransaction(jupTx.serialize(), {
    skipPreflight: true,
    maxRetries: 2,
  });

  return signature;
}

export async function executeCopyTrade(summary: SwapSummary): Promise<void> {
  const mint = summary.mint;
  if (!mint) {
    throw new Error("No mint in swap summary");
  }

  const lamports =
    Number(process.env.BUY_AMOUNT_LAMPORTS) || DEFAULT_BUY_LAMPORTS;
  const slippage = Number(process.env.SLIPPAGE) || DEFAULT_SLIPPAGE;

  const wallet = getWalletKeypair();
  const connection = getConnection();

  // Non-Pump sources (e.g. Meteora, Jupiter, Raydium) use Jupiter aggregator.
  if (!isPumpSwap(summary)) {
    const signature = await executeJupiterBuy(
      connection,
      wallet,
      mint,
      lamports,
      slippage
    );
    console.log(
      "[CopyTrade] Jupiter-based swap sent (source:",
      summary.source,
      "):",
      signature
    );
    void confirmTransactionInBackground(
      connection,
      signature,
      "[CopyTrade] Jupiter-based swap"
    );
    return;
  }

  const pumpAmmSdk = new PumpAmmSdk();
  const onlineSdk = new OnlinePumpAmmSdk(connection);

  const baseMint = new PublicKey(mint);
  const poolKey = canonicalPumpPoolPda(baseMint);

  const swapSolanaState = await onlineSdk.swapSolanaState(
    poolKey,
    wallet.publicKey
  );

  const quoteAmount = new BN(lamports);

  // Fetch blockhash in parallel with price guard + instruction build (saves ~100–300ms)
  const blockhashPromise = connection.getLatestBlockhash("confirmed");

  // Price guard: skip if current price is worse than configured threshold vs target's buy
  const priceGuardFactor =
    Number(process.env.PRICE_GUARD_FACTOR) || DEFAULT_PRICE_GUARD_FACTOR;
  const targetInfo = getTargetBuyInfo(summary);
  if (
    targetInfo &&
    targetInfo.solLamports > 0 &&
    targetInfo.tokensReceived > 0 &&
    priceGuardFactor > 0
  ) {
    const targetTokensPerSol =
      targetInfo.tokensReceived / (targetInfo.solLamports / 1e9);
    const ourSolAmount = lamports / 1e9;
    const minTokensRequired = targetTokensPerSol * ourSolAmount * priceGuardFactor;

    const { base } = buyQuoteInput({
      quote: quoteAmount,
      slippage,
      baseReserve: swapSolanaState.poolBaseAmount,
      quoteReserve: swapSolanaState.poolQuoteAmount,
      globalConfig: swapSolanaState.globalConfig,
      baseMintAccount: swapSolanaState.baseMintAccount,
      baseMint: swapSolanaState.baseMint,
      coinCreator: swapSolanaState.pool.coinCreator,
      creator: swapSolanaState.pool.creator,
      feeConfig: swapSolanaState.feeConfig,
    });

    const decimals = swapSolanaState.baseMintAccount.decimals;
    const ourTokensReceived =
      base.toNumber() / Math.pow(10, decimals);

    if (ourTokensReceived < minTokensRequired) {
      const worsePercent = ((1 - priceGuardFactor) * 100).toFixed(0);
      throw new Error(
        `Price moved >${worsePercent}% against us. Expected min ${minTokensRequired.toFixed(2)} tokens, quote gives ${ourTokensReceived.toFixed(2)}. Skipping buy.`
      );
    }
  }

  const buyInstructions = await pumpAmmSdk.buyQuoteInput(
    swapSolanaState,
    quoteAmount,
    slippage
  );

  // microLamports per CU so that at ~130k CU we pay PRIORITY_FEE_LAMPORTS
  const computeUnitPrice = Math.ceil(
    (PRIORITY_FEE_LAMPORTS * 1_000_000) / 130_000
  );
  const computeBudgetIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: computeUnitPrice,
    }),
  ];

  const transaction = new Transaction().add(
    ...computeBudgetIxs,
    ...buyInstructions
  );
  const { blockhash } = await blockhashPromise;
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  // Skip preflight to save one RPC round-trip (~100–400ms). Guard already validated price.
  const signature = await connection.sendTransaction(
    transaction,
    [wallet],
    {
      skipPreflight: true,
      preflightCommitment: "confirmed",
      maxRetries: 2,
    } as SendOptions
  );

  console.log("[CopyTrade] Swap sent:", signature);

  // Confirm in background so we return fast; webhook isn't blocked.
  void confirmTransactionInBackground(
    connection,
    signature,
    "[CopyTrade] Swap"
  );
}
