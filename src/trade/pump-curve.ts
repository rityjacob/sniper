import BN from "bn.js";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  type FeeConfig,
  type Global,
} from "./pump-sdk.js";
import { buildLegacyTransaction, computeBudgetInstructions } from "./send.js";
import type { BuyContext, VenueQuote } from "./types.js";

// Global and FeeConfig rarely change; caching them saves two RPC calls per buy.
const PROTOCOL_CACHE_MS = 60_000;
let protocolCache: { at: number; value: Promise<{ global: Global; feeConfig: FeeConfig }> } | undefined;

function getProtocolState(sdk: OnlinePumpSdk): Promise<{ global: Global; feeConfig: FeeConfig }> {
  if (!protocolCache || Date.now() - protocolCache.at > PROTOCOL_CACHE_MS) {
    const value = Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]).then(
      ([global, feeConfig]) => ({ global, feeConfig })
    );
    value.catch(() => (protocolCache = undefined));
    protocolCache = { at: Date.now(), value };
  }
  return protocolCache.value;
}

/** Buy on the Pump.fun bonding curve (token not yet migrated to PumpSwap). */
export async function quotePumpCurve(ctx: BuyContext): Promise<VenueQuote> {
  const { connection, wallet, mint, tokenProgram, decimals, lamports, config } = ctx;
  const sdk = new OnlinePumpSdk(connection);

  const [{ global, feeConfig }, state] = await Promise.all([
    getProtocolState(sdk),
    sdk.fetchBuyState(mint, wallet.publicKey, tokenProgram),
  ]);
  const { bondingCurve, bondingCurveAccountInfo, associatedUserAccountInfo, quoteTokenProgram } = state;

  if (bondingCurve.complete) throw new Error("Bonding curve is complete (migrating to PumpSwap)");

  const quoteAmount = new BN(lamports);
  const common = {
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user: wallet.publicKey,
    quoteAmount,
    slippage: config.slippagePercent,
    tokenProgram,
    quoteTokenProgram,
  };

  // v3 refuses old cashback coins; those still trade with v2.
  let amount: BN;
  let buildInstructions: () => ReturnType<typeof PUMP_SDK.buyV2Instructions>;
  if (bondingCurve.isCashbackCoin) {
    amount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: quoteAmount,
      quoteMint: bondingCurve.quoteMint,
    });
    buildInstructions = () =>
      PUMP_SDK.buyV2Instructions({ ...common, global, bondingCurveAccountInfo, amount });
  } else {
    amount = getBuyV3TokenAmountFromQuoteAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: quoteAmount,
      curveBaseTokenBalance: state.curveBaseTokenBalance,
    });
    buildInstructions = () => PUMP_SDK.buyExactQuoteInV3Instructions({ ...common, amount });
  }

  if (amount.isZero()) throw new Error("Bonding curve quote returned 0 tokens");

  return {
    venue: "pump-curve",
    expectedTokens: Number(amount.toString()) / 10 ** decimals,
    async buildTransaction() {
      const instructions = await buildInstructions();
      return buildLegacyTransaction(
        [...computeBudgetInstructions(config.priorityFeeLamports), ...instructions],
        wallet,
        ctx.blockhash
      );
    },
  };
}
