# Pump.fun Leader Buy Detection & Trading

This branch implements automated trading based on leader wallet activity on Pump.fun's custom bonding curve AMM.

## Overview

This implementation follows a specific workflow to detect and copy leader wallet trades:

1. **Receive webhook** from target wallet
2. **Detect "leader bought on PumpSwap"** - analyze transaction logs
3. **Parse webhook's enhanced transaction payload** - extract key information
4. **Confirm Pump.fun AMM program invocation** - validate it's a real PumpSwap
5. **Confirm leader wallet is the buyer** - verify token receipt
6. **Extract token mint received** - identify the token being traded
7. **Confirm pool exists** - ensure token has graduated to AMM
8. **Check SOL balance** - verify sufficient funds for fixed buy + fees
9. **Execute BUY** - use Pump.fun SDK with priority fees and slippage
10. **Post-trade logging** - log signature, store status, handle retries

## Webhook Data Structure

When you receive a webhook from Pump.fun, it contains:

```typescript
interface PumpFunWebhook {
    inputMint: string;        // Input token mint address
    outputMint: string;       // Output token mint address
    amount: string;           // Amount in lamports
    accounts: string[];       // Required account addresses
    programId: string;        // Always troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61
    data: string;             // Base64-encoded instruction
}
```

## How It Works

### 1. Decode and Analyze Instruction

The system decodes the base64 instruction data and analyzes its structure:

```typescript
// Decode base64 instruction
const raw = Buffer.from(webhookData.data, 'base64');

// Analyze structure (typically):
// - First byte: Function ID
// - Next 8 bytes: Amount (u64 little-endian)
// - Remaining bytes: Additional parameters
const functionId = raw[0];
const amountBytes = raw.slice(1, 9);
const amount = amountBytes.readBigUInt64LE(0);
```

### 2. Update Amount and Rebuild Instruction

Replace the amount in the instruction with your desired amount:

```typescript
// Encode new amount as u64 little-endian
function encodeU64LE(amount: bigint): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(amount);
    return buf;
}

// Rebuild instruction with new amount
const newAmountBytes = encodeU64LE(newAmount);
const updatedData = Buffer.concat([
    Buffer.from([functionId]),
    newAmountBytes,
    remainingData
]);
```

### 3. Execute Transaction

Create and send the transaction using the same accounts but with your wallet as the signer:

```typescript
const instruction = new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM_ID,
    keys: convertToAccountMeta(webhookData.accounts, true),
    data: updatedInstructionData
});

const transaction = new Transaction();
transaction.add(instruction);
const signature = await walletManager.signAndSendTransaction(transaction);
```

## Usage

### Basic Usage

```typescript
import { dexManager } from './src/dex';
import { PumpFunWebhook } from './src/types';

// Process webhook data and execute swap
const webhookData: PumpFunWebhook = {
    inputMint: 'So11111111111111111111111111111111111111112', // SOL
    outputMint: 'TokenMintAddressHere',
    amount: '1000000000', // 1 SOL in lamports
    accounts: ['WalletAddress', 'TokenAccount1', 'TokenAccount2'],
    programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
    data: 'TBXxRE...' // Base64 instruction data
};

// Execute fixed buy amount (0.1 SOL)
const signature = await dexManager.processLeaderBuyWebhook(webhookData, 0.1);
console.log('Trade signature:', signature);
```

### Using Default Buy Amount

```typescript
// Use default buy amount (0.1 SOL)
const signature = await dexManager.processLeaderBuyWebhook(webhookData);
```

## Key Features

1. **Leader Buy Detection**: Automatically detects when target wallet buys on PumpSwap
2. **Enhanced Webhook Processing**: Parses full transaction payload with logs and metadata
3. **Validation Chain**: Multiple validation steps ensure legitimate trades
4. **Fixed Buy Amounts**: Uses configurable fixed SOL amounts for consistency
5. **Priority Fees**: Adds priority fees for faster transaction processing
6. **Retry Logic**: Handles "Blockhash not found" and "RPC busy" errors
7. **Comprehensive Logging**: Detailed logging for monitoring and debugging

## Configuration

Update your config to enable Pump.fun:

```typescript
export const DEX_CONFIG = {
    // ... other config
    pumpFunProgramId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
    enablePumpFun: true
};
```

## Error Handling

The implementation includes comprehensive error handling:

- Invalid base64 instruction data
- Insufficient wallet balance
- Invalid program ID
- Transaction retry logic
- Detailed logging

## Testing

Run the example script to test the implementation:

```bash
npx ts-node src/scripts/pump-fun-example.ts
```

## Important Notes

1. **Webhook Data Required**: All swaps require valid webhook data from Pump.fun
2. **Account Validation**: Ensure all required accounts are provided in the webhook
3. **Amount Limits**: Respect your configured amount limits
4. **Gas Fees**: Pump.fun transactions may have different gas requirements
5. **Slippage**: Slippage is handled by the bonding curve, not traditional order books

## Migration from Jupiter

To migrate from Jupiter to Pump.fun:

1. Replace `executeSwap()` calls with `processLeaderBuyWebhook()`
2. Ensure you have enhanced webhook data with transaction payload
3. Configure fixed buy amounts instead of dynamic amounts
4. Test thoroughly with small amounts first

## Example Webhook Handler

```typescript
// In your webhook endpoint
app.post('/pump-fun-webhook', async (req, res) => {
    try {
        const webhookData: PumpFunWebhook = req.body;
        
        // Validate webhook data
        if (webhookData.programId !== 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61') {
            return res.status(400).json({ error: 'Invalid program ID' });
        }
        
        // Execute swap
        const signature = await dexManager.processWebhookAndSwap(webhookData, 0.1);
        
        res.json({ success: true, signature });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```
