import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SendOptions,
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

  for (const n of summary.nativeTransfers) {
    if (n.fromUserAccount === feePayer) {
      solLamports += n.amount;
    }
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
  const pumpAmmSdk = new PumpAmmSdk();
  const onlineSdk = new OnlinePumpAmmSdk(connection);

  const baseMint = new PublicKey(mint);
  const poolKey = canonicalPumpPoolPda(baseMint);

  const swapSolanaState = await onlineSdk.swapSolanaState(
    poolKey,
    wallet.publicKey
  );

  const quoteAmount = new BN(lamports);

  // Skip if current price is >40% worse than target's buy price
  const targetInfo = getTargetBuyInfo(summary);
  if (
    targetInfo &&
    targetInfo.solLamports > 0 &&
    targetInfo.tokensReceived > 0
  ) {
    const targetTokensPerSol =
      targetInfo.tokensReceived / (targetInfo.solLamports / 1e9);
    const ourSolAmount = lamports / 1e9;
    const minTokensRequired = targetTokensPerSol * ourSolAmount * 0.6;

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
      throw new Error(
        `Price moved >25% against us. Expected min ${minTokensRequired.toFixed(2)} tokens, quote gives ${ourTokensReceived.toFixed(2)}. Skipping buy.`
      );
    }
  }
  const buyInstructions = await pumpAmmSdk.buyQuoteInput(
    swapSolanaState,
    quoteAmount,
    slippage
  );

  const transaction = new Transaction().add(...buyInstructions);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  const signature = await connection.sendTransaction(
    transaction,
    [wallet],
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    } as SendOptions
  );

  console.log("[CopyTrade] Swap sent:", signature);

  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const status = await connection.getSignatureStatus(signature);
    if (
      status.value?.confirmationStatus === "confirmed" ||
      status.value?.confirmationStatus === "finalized"
    ) {
      console.log("[CopyTrade] Swap confirmed:", signature);
      return;
    }
    if (status.value?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Transaction confirmation timed out");
}
