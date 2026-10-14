import type { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Config } from "../config.js";

export type Venue = "pump-curve" | "pump-amm" | "jupiter";

export interface BuyContext {
  connection: Connection;
  config: Config;
  wallet: Keypair;
  mint: PublicKey;
  /** Owner program of the mint (SPL Token or Token-2022). */
  tokenProgram: PublicKey;
  decimals: number;
  lamports: number;
  blockhash: Promise<{ blockhash: string }>;
}

/** A priced buy: check the price, then build the signed transaction. */
export interface VenueQuote {
  venue: Venue;
  /** Tokens we expect to receive, UI amount (decimals applied). */
  expectedTokens: number;
  buildTransaction(): Promise<Transaction | VersionedTransaction>;
}
