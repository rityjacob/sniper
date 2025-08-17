# Pump.fun AMM Integration

This branch implements trading using Pump.fun's custom bonding curve AMM instead of Jupiter API.

## Overview

Pump.fun uses a custom bonding curve AMM that:
- Exists on-chain (no REST API)
- Has a fixed program ID: `troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61`
- Accepts a single swap instruction encoded as base64 in transactions
- The swap logic lives inside that instruction, including:
  - Input amount
  - Source wallet
  - Token accounts

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

// Execute swap with 0.1 SOL
const signature = await dexManager.processWebhookAndSwap(webhookData, 0.1);
console.log('Swap signature:', signature);
```

### Using Webhook Amount

```typescript
// Use the amount from the webhook
const signature = await dexManager.processWebhookAndSwap(webhookData);
```

### Direct Pump.fun Swap

```typescript
// Execute swap directly with webhook data
const signature = await dexManager.executePumpFunSwap(webhookData, 0.05);
```

## Key Differences from Jupiter

1. **No API Calls**: Pump.fun doesn't use REST APIs - everything is on-chain
2. **Webhook Required**: All swaps require webhook data from Pump.fun
3. **Instruction Decoding**: Need to decode and modify base64 instruction data
4. **Account Structure**: Uses specific account structure from webhook
5. **Bonding Curve**: Price is determined by the bonding curve, not market orders

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

1. Replace `executeSwap()` calls with `processWebhookAndSwap()`
2. Ensure you have webhook data for each trade
3. Update any price calculation logic (Pump.fun uses bonding curves)
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
