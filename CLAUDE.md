# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Solana meme-coin copy-trading bot. An Express server receives Helius "enhanced transaction" webhooks. When a watched wallet makes a BUY swap, the bot buys the same token from its own wallet with real SOL on mainnet. Code that touches `executeCopyTrade` sends live transactions, so don't run it against a funded `WALLET_PK` unless the user asks you to.

## Git workflow

Commit and push to GitHub as you work so progress is never lost. Don't save it all up for the end of a task.

- Commit each logical unit of work once it's complete and `npm test` passes (or after a checkpoint you'd hate to lose). Push right after committing (`git push`).
- Write clean commit messages: a short imperative subject (e.g. `Add price guard to Jupiter path`), plus a body explaining the *why* when it isn't obvious. Avoid vague messages like `fix 2` or `fetch fix`.
- Keep each commit focused. Don't mix unrelated changes, and never commit `.env` or secrets.

## Commands

```bash
npm run dev          # tsx watch src/index.ts (loads .env via dotenv)
npm run build        # tsc -> dist/
npm start            # node dist/index.js
npm test             # vitest run (all tests)
npm run test:watch
npx vitest run src/swap-processor.test.ts       # single file
npx vitest run -t "getTargetBuyInfo"            # tests matching a name
```

There is no linter. Type-check with `npx tsc --noEmit`. This is an ESM project (`"type": "module"`, `NodeNext`), so relative imports need the `.js` extension (e.g. `./webhook.js`). `tsconfig.json` excludes only `src/__tests__/`, so the colocated `src/*.test.ts` files also get compiled into `dist/`.

## Architecture

The request flow is linear across the modules in `src/`:

1. **`index.ts`** sets up Express with `/health` and `/webhook`, logs the config at startup, and runs a keep-alive self-ping every 14 minutes to `RENDER_EXTERNAL_URL`/`SELF_URL`. This stops Render's free tier from sleeping the service (see `render.yaml`).
2. **`webhook.ts`** handles `POST /webhook/helius`. It accepts a single event or an array of events. For each one it calls `processSwapTransaction`, then `shouldCopyBuy`, and if the result is true it fires `onBuyTransaction` **without awaiting it**. The handler always responds 200 right away and echoes the payload. Trades run detached from the HTTP response.
3. **`swap-processor.ts`** turns a Helius event into a `SwapSummary`. It ignores anything where `type !== "SWAP"`. The traded mint is the first non-WSOL token transfer. Side is decided by whether `feePayer` is the recipient (BUY) or the sender (SELL) of that transfer. `shouldCopyBuy` only copies BUYs where `TARGET_WALLET` appears as the fee payer or in any transfer, or copies every BUY when `COPY_ALL_BUYS=true`. `onBuyTransaction` catches and logs all trade errors.
4. **`copy-trade.ts`** runs the trade. It routes on `summary.source`:
   - **Pump sources** (source contains `"pump"`) use `@pump-fun/pump-swap-sdk` against the canonical Pump AMM pool PDA. This path is latency-optimized: the blockhash is fetched in parallel with building the trade, `skipPreflight` is on, and compute-budget instructions set a fixed priority fee. It also has a **price guard**: using `getTargetBuyInfo`, it derives the target's tokens-per-SOL rate and aborts if our quote is below `rate × PRICE_GUARD_FACTOR`. Slippage is capped at 50% on this path to avoid Pump AMM error 6023.
   - **Everything else** (Raydium, Meteora, etc.) goes through the Jupiter quote API and then the Jupiter swap API, which returns a serialized versioned tx that we sign and send raw. This path has no price guard.
   - Both paths confirm the transaction in the background (`confirmTransactionInBackground` polls 5×1s) and only log the result.

`src/types/helius.ts` defines the Helius payload and `SwapSummary` types.

## Environment variables

| Var | Purpose / default |
|---|---|
| `WALLET_PK` | Trading wallet secret key: base58, a JSON byte array, or comma-separated bytes |
| `RPC_URL` | Solana RPC, default public mainnet-beta |
| `TARGET_WALLET` | Wallet to copy. The hardcoded default appears in **both** `index.ts` and `swap-processor.ts` |
| `COPY_ALL_BUYS` | `"true"` copies every BUY swap in the webhook stream |
| `BUY_AMOUNT_LAMPORTS` | Default 20,000,000 (0.02 SOL) |
| `SLIPPAGE` | Percent (1 = 1%), default 40 |
| `PRICE_GUARD_FACTOR` | Default 0.5. Lower is looser; 0 effectively disables it (Pump path only) |
| `PORT`, `RENDER_EXTERNAL_URL` / `SELF_URL` | Server port and keep-alive target |

The priority fee (`PRIORITY_FEE_LAMPORTS`) and compute-unit limit are constants in `copy-trade.ts`, not env vars.
