# Leader Buy Detection Fix

## Problem Summary

The "leader not found" error was occurring because:

1. **The transaction was a SELL, not a BUY**: The target wallet was selling tokens for SOL, not buying tokens with SOL
2. **Incorrect webhook data construction**: The `inputMint` was being set to a wallet address instead of a token mint address
3. **Missing buy/sell direction detection**: The system wasn't properly distinguishing between buy and sell transactions

## Root Cause Analysis

### From Your Logs:
```
[INFO][webhook] Pump.fun SWAP detected
Details: Token: Aia5bA9duTSFK5t4mjzeueLs5cV3LzgDMR6QUYk6pump, Amount: 2039280
[INFO][dex] Not a Pump.fun transaction
Details: Skipping non-Pump.fun transaction
[ERROR][dex] Leader buy webhook processing failed
Details: Not a leader buy transaction
```

### From Solscan Transaction Analysis:
- The transaction shows `baseAmountOut: "29597643122728"` (tokens going OUT)
- The transaction shows `quoteAmountIn: "7000000001"` (SOL going IN)
- There's a "Close Token Account" action that redeems SOL back to the wallet
- **This indicates the target wallet was SELLING tokens for SOL, not buying tokens with SOL**

## Fixes Implemented

### 1. Enhanced Webhook Data Construction (`src/webhook-server.ts`)

**Before:**
```typescript
const webhookData = {
    inputMint: tx.nativeTransfers?.[0]?.fromUserAccount || 'So11111111111111111111111111111111111111112',
    outputMint: tx.tokenTransfers?.[0]?.mint || '',
    // ...
};
```

**After:**
```typescript
// Analyze the transaction to determine if it's a buy or sell
const targetBuying = tokenTransfers.some((transfer: any) => 
    transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet
);

const targetSelling = tokenTransfers.some((transfer: any) => 
    transfer.fromUserAccount === targetWallet || transfer.fromTokenAccount === targetWallet
);

// Determine input and output mints based on transaction direction
let inputMint, outputMint;
if (targetBuying) {
    // Target is buying: SOL → Token
    inputMint = 'So11111111111111111111111111111111111111112'; // WSOL
    outputMint = tokenTransfers.find((t: any) => 
        t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
    )?.mint || '';
} else if (targetSelling) {
    // Target is selling: Token → SOL
    inputMint = tokenTransfers.find((t: any) => 
        t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
    )?.mint || '';
    outputMint = 'So11111111111111111111111111111111111111112'; // WSOL
}
```

### 2. Buy/Sell Direction Filtering

**Added logic to only process buy transactions:**
```typescript
// Only process if target wallet is buying (we want to copy buys, not sells)
if (targetBuying) {
    // Process the webhook and execute trade
    const signature = await dexManager.processLeaderBuyWebhook(webhookData, fixedBuyAmount);
} else {
    logger.logInfo('webhook', 'Skipping sell transaction', 
        `Target wallet is selling, not buying. Token: ${webhookData.inputMint}`
    );
}
```

### 3. Enhanced Detection Logic (`src/dex.ts`)

**Improved logging and validation:**
```typescript
private detectLeaderBuy(webhookData: PumpFunWebhook): boolean {
    try {
        logger.logInfo('dex', 'Detecting leader buy', 
            `ProgramId: ${webhookData.programId}, InputMint: ${webhookData.inputMint}, OutputMint: ${webhookData.outputMint}`
        );

        // Check if it's a Pump.fun transaction
        const isPumpFun = webhookData.programId === PUMP_FUN_PROGRAM_ID.toString() || 
                         webhookData.source === 'PUMP_AMM';

        if (!isPumpFun) {
            logger.logInfo('dex', 'Not a Pump.fun transaction', 
                `ProgramId: ${webhookData.programId}, Expected: ${PUMP_FUN_PROGRAM_ID.toString()}`
            );
            return false;
        }

        // Check if it's a buy (WSOL → token)
        const isBuy = webhookData.inputMint === WSOL_MINT.toString() && 
                     webhookData.outputMint !== WSOL_MINT.toString();

        if (!isBuy) {
            logger.logInfo('dex', 'Not a buy transaction', 
                `InputMint: ${webhookData.inputMint}, OutputMint: ${webhookData.outputMint}, Expected Input: ${WSOL_MINT.toString()}`
            );
            return false;
        }

        // Additional validation: check if we have valid token mints
        if (!webhookData.outputMint || webhookData.outputMint === '') {
            logger.logWarning('dex', 'Invalid output mint', 'Output mint is empty or undefined');
            return false;
        }

        return true;
    } catch (error) {
        logger.logError('dex', 'Error detecting leader buy', error instanceof Error ? error.message : String(error));
        return false;
    }
}
```

### 4. Debug Script (`src/scripts/debug-webhook.ts`)

Created a comprehensive debug script to analyze webhook data structure and transaction details.

## Expected Behavior After Fix

1. **Buy Transactions**: When the target wallet buys tokens with SOL, the system will:
   - Correctly identify it as a buy transaction
   - Set `inputMint` to WSOL and `outputMint` to the token mint
   - Process the webhook and execute the copy trade

2. **Sell Transactions**: When the target wallet sells tokens for SOL, the system will:
   - Correctly identify it as a sell transaction
   - Log "Skipping sell transaction" and not attempt to copy the trade
   - Continue monitoring for the next buy transaction

3. **Better Logging**: More detailed logs will help you understand:
   - Whether a transaction is a buy or sell
   - Why a transaction was skipped
   - What the correct input/output mints should be

## Testing the Fix

1. **Monitor the logs** for the next Pump.fun transaction
2. **Look for these new log messages**:
   - `"Target wallet is buying"` or `"Target wallet is selling"`
   - `"Skipping sell transaction"` for sell transactions
   - More detailed detection logs showing program IDs and mint addresses

3. **Use the debug script** to analyze webhook data:
   ```bash
   npx ts-node src/scripts/debug-webhook.ts
   ```

## Key Takeaways

- **The "leader not found" error was actually correct behavior** - the system was properly rejecting a sell transaction
- **The fix ensures you only copy buy transactions**, not sell transactions
- **Enhanced logging will help you understand transaction flow** and debug future issues
- **The system now properly distinguishes between buy and sell directions** based on token transfer patterns
