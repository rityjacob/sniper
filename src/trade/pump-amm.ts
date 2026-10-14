import BN from "bn.js";
import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  buyQuoteInput,
  canonicalPumpPoolPda,
} from "@pump-fun/pump-swap-sdk";
import { buildLegacyTransaction, computeBudgetInstructions } from "./send.js";
import type { BuyContext, VenueQuote } from "./types.js";

// Higher slippage overflows the Pump AMM instruction (custom error 6023).
const MAX_PUMP_AMM_SLIPPAGE_PERCENT = 50;

/** Buy on PumpSwap AMM (token graduated from the bonding curve). */
export async function quotePumpAmm(ctx: BuyContext): Promise<VenueQuote> {
  const { connection, wallet, mint, decimals, lamports, config } = ctx;
  const slippage = Math.min(config.slippagePercent, MAX_PUMP_AMM_SLIPPAGE_PERCENT);

  const state = await new OnlinePumpAmmSdk(connection).swapSolanaState(
    canonicalPumpPoolPda(mint),
    wallet.publicKey
  );
  const quoteAmount = new BN(lamports);

  const { pool } = state;
  const { base } = buyQuoteInput({
    quote: quoteAmount,
    slippage,
    baseReserve: state.poolBaseAmount,
    quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: pool.virtualQuoteReserves,
    globalConfig: state.globalConfig,
    baseMintAccount: state.baseMintAccount,
    baseMint: state.baseMint,
    coinCreator: pool.coinCreator,
    creator: pool.creator,
    feeConfig: state.feeConfig,
    quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode,
    creatorFeeBps: pool.creatorFeeBps,
  });

  return {
    venue: "pump-amm",
    expectedTokens: Number(base.toString()) / 10 ** decimals,
    async buildTransaction() {
      // v2 is the leaner buy instruction; the SDK falls back to v1 on pools without it.
      const instructions = await PUMP_AMM_SDK.buyQuoteInput(state, quoteAmount, slippage, { v2: true });
      return buildLegacyTransaction(
        [...computeBudgetInstructions(config.priorityFeeLamports), ...instructions],
        wallet,
        ctx.blockhash
      );
    },
  };
}
