# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Solana meme-coin copy-trading bot. An Express server receives Helius "enhanced transaction" webhooks. When a watched wallet makes a BUY swap, the bot buys the same token from its own wallet with real SOL on mainnet. Code that touches `executeCopyBuy` sends live transactions, so don't run it against a funded `WALLET_PK` unless the user asks you to. Set `DRY_RUN=true` to simulate instead of send.

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
npx vitest run src/__tests__/swap-processor.test.ts   # single file
npx vitest run -t "parseTargetBuy"                    # tests matching a name
```

There is no linter. Type-check with `npx tsc --noEmit`. This is an ESM project (`"type": "module"`, `NodeNext`), so relative imports need the `.js` extension (e.g. `./webhook.js`). Tests live in `src/__tests__/`, which `tsconfig.json` excludes from the build; keep new tests there.

## Architecture

The request flow is linear across the modules in `src/`:

1. **`index.ts`** loads `config.ts` at startup (fails fast on missing env), sets up Express with `/health` and `/webhook`, and runs a keep-alive self-ping every 14 minutes to `RENDER_EXTERNAL_URL`/`SELF_URL` so Render's free tier doesn't sleep the service (see `render.yaml`).
2. **`webhook.ts`** handles `POST /webhook/helius` (single event or array). For each event: `parseTargetBuy` → dedupe by signature (`dedupe.ts`, in-memory, 10 min TTL) → `executeCopyBuy` fired **without awaiting**. It responds `{ received, count }` right away.
3. **`swap-processor.ts`** `parseTargetBuy` returns a `TargetBuy` only when `type === "SWAP"`, the target is the fee payer, the target received exactly one non-WSOL mint and sent none. Otherwise it returns `{ skip: reason }`. `getSolSpentLamports` prefers the target's `accountData.nativeBalanceChange` (minus fee) to avoid double counting SOL wrapped to WSOL.
4. **`trade/index.ts`** `executeCopyBuy` makes one `getMultipleAccountsInfo` call (mint, bonding curve PDA, canonical PumpSwap pool PDA) and picks the venue from on-chain state, not Helius `source`:
   - **`pump-curve.ts`**: live, SOL-quoted bonding curve → `@pump-fun/pump-sdk` (`buyExactQuoteInV3Instructions`, or v2 for cashback coins). Imported via `trade/pump-sdk.ts` because the SDK's ESM build crashes under Node; it loads the CJS build with `createRequire`.
   - **`pump-amm.ts`**: canonical PumpSwap pool exists → `@pump-fun/pump-swap-sdk` v2 (`buyQuoteInput` with `{ v2: true }`). SDK 1.x fails on-chain with 6062 `InvalidPoolV2`.
   - **`jupiter.ts`**: everything else, `/swap/v1/quote` + `/swap/v1/swap`. Also the fallback if a Pump quote errors.
   - **`price-guard.ts`**: every venue's quote is checked against the target's price; the buy is skipped if ours is more than `MAX_PRICE_INCREASE_PERCENT` higher.
   - **`send.ts`**: compute budget (150k CU limit, price sized so the total priority fee equals `PRIORITY_FEE_LAMPORTS`), `skipPreflight` send, background confirmation (30×1s). With `DRY_RUN` it simulates instead.

`src/types/helius.ts` defines the Helius payload and `TargetBuy` types.

## Environment variables

| Var | Purpose / default |
|---|---|
| `TARGET_WALLET` | **Required.** Wallet to copy |
| `WALLET_PK` | **Required.** Trading wallet secret key: base58, a JSON byte array, or comma-separated bytes |
| `RPC_URL` | Solana RPC, default public mainnet-beta (use a paid RPC in production) |
| `BUY_AMOUNT_LAMPORTS` | Default 20,000,000 (0.02 SOL) |
| `SLIPPAGE` | Percent, default 25 (capped at 50 on PumpSwap) |
| `MAX_PRICE_INCREASE_PERCENT` | Max % our price may exceed the target's, default 25 |
| `PRIORITY_FEE_LAMPORTS` | Total priority fee per buy, default 1,900,000 |
| `JUPITER_API_URL` / `JUPITER_API_KEY` | Default `https://lite-api.jup.ag`; with a key, `https://api.jup.ag` |
| `DRY_RUN` | `"true"` simulates transactions instead of sending |
| `PORT`, `RENDER_EXTERNAL_URL` / `SELF_URL` | Server port and keep-alive target |

Numeric env vars accept 0 (unset means default).
