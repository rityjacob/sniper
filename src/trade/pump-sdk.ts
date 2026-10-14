import { createRequire } from "module";

// @pump-fun/pump-sdk's ESM build crashes under Node (a dependency does a named
// import of BN from the CommonJS @coral-xyz/anchor). Its CommonJS build works,
// so load that one and keep the package's types.
const require = createRequire(import.meta.url);
const pumpSdk = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");

export const {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  isSolLikeQuoteMint,
} = pumpSdk;
export type OnlinePumpSdk = InstanceType<typeof OnlinePumpSdk>;
export type { FeeConfig, Global } from "@pump-fun/pump-sdk";
