# Pump Swap SDK Integration - Copy Trading Bot

This implementation uses the official Pump Swap SDK (`@pump-fun/pump-swap-sdk`) to perform copy trading on Pump.fun's bonding curve AMM.

## 🚀 Key Features

- **Official SDK Integration**: Uses `PumpAmmInternalSdk` for low-level programmatic control
- **Copy Trading**: Automatically copies buy transactions from target wallet
- **Real-time Webhook Processing**: Receives Helius webhooks and processes them instantly
- **Pool State Management**: Fetches real-time pool data for accurate calculations
- **Slippage Protection**: Configurable slippage tolerance for trades
- **Comprehensive Logging**: Detailed logs for monitoring and debugging

## 📋 Architecture

### 1. Webhook Reception (`webhook-server.ts`)
- Receives Helius webhooks via POST `/webhook`
- Extracts transaction data and determines buy/sell direction
- Validates target wallet involvement
- Triggers copy trade execution

### 2. Copy Trade Processing (`dex.ts`)
- Uses `PumpAmmInternalSdk` for swap operations
- Fetches real-time pool state via `swapSolanaState()`
- Calculates optimal trade amounts using SDK functions
- Executes trades with proper slippage protection

### 3. Pool State Management
- `getSwapState()`: Fetches current pool reserves and configuration
- `calculateBuyAmount()`: Uses `buyQuoteInputInternal()` for buy calculations
- `calculateSellAmount()`: Uses `sellBaseInputInternal()` for sell calculations

## 🔧 SDK Usage

### Core SDK Functions Used

```typescript
// High-level SDK for state fetching
const pumpAmmSdk = new PumpAmmSdk(connection);
const swapState = await pumpAmmSdk.swapSolanaState(poolKey, user);

// Low-level SDK for trade execution
const pumpAmmInternalSdk = new PumpAmmInternalSdk(connection);

// Buy tokens with SOL
const buyInstructions = await pumpAmmInternalSdk.buyQuoteInput(
    swapState, 
    quoteAmount, 
    slippage
);

// Sell tokens for SOL
const sellInstructions = await pumpAmmInternalSdk.sellBaseInput(
    swapState, 
    baseAmount, 
    slippage
);
```

### Calculation Functions

```typescript
// Calculate buy amount (SOL → Token)
const { uiQuote, base } = buyQuoteInputInternal(
    quoteAmount,    // SOL amount in lamports
    slippage,       // Slippage tolerance (0.01 = 1%)
    poolBaseAmount, // Current token reserves
    poolQuoteAmount,// Current SOL reserves
    globalConfig,   // Pool configuration
    pool.creator    // Pool creator
);

// Calculate sell amount (Token → SOL)
const { uiQuote, quote } = sellBaseInputInternal(
    baseAmount,     // Token amount
    slippage,       // Slippage tolerance
    poolBaseAmount, // Current token reserves
    poolQuoteAmount,// Current SOL reserves
    globalConfig,   // Pool configuration
    pool.creator    // Pool creator
);
```

## 🎯 Copy Trading Flow

### 1. Webhook Reception
```typescript
// Helius sends webhook with transaction data
app.post('/webhook', async (req, res) => {
    const webhookData = extractWebhookData(tx);
    
    if (webhookData.isBuy) {
        // Execute copy trade
        const signature = await dexManager.processLeaderBuyWebhook(
            webhookData, 
            fixedBuyAmount
        );
    }
});
```

### 2. Pool State Fetching
```typescript
// Get real-time pool data
const swapState = await pumpAmmSdk.swapSolanaState(poolKey, userWallet);
const { globalConfig, pool, poolBaseAmount, poolQuoteAmount } = swapState;
```

### 3. Trade Calculation
```typescript
// Calculate optimal buy amount
const buyCalculation = buyQuoteInputInternal(
    quoteAmount,    // SOL to spend
    slippage,       // 1% slippage
    poolBaseAmount, // Token reserves
    poolQuoteAmount,// SOL reserves
    globalConfig,
    pool.creator
);
```

### 4. Trade Execution
```typescript
// Execute buy transaction
const instructions = await pumpAmmInternalSdk.buyQuoteInput(
    swapState,
    quoteAmount,
    slippage
);

const transaction = new Transaction();
transaction.add(...instructions);
const signature = await walletManager.signAndSendTransaction(transaction);
```

## ⚙️ Configuration

### Environment Variables
```bash
TARGET_WALLET_ADDRESS=your_target_wallet_address
WALLET_PRIVATE_KEY=your_bot_wallet_private_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
FIXED_BUY_AMOUNT=0.1  # SOL amount per copy trade
```

### Slippage Settings
```typescript
const defaultSlippage = 0.01; // 1% slippage tolerance
```

## 🧪 Testing

### Run the test script
```bash
npx ts-node src/scripts/test-pump-swap-sdk.ts
```

### Test endpoints
- `GET /health` - Health check
- `GET /status` - Bot status and configuration
- `POST /test-webhook` - Test webhook reception

## 📊 Monitoring

### Logs to Watch
```
[INFO][webhook] Copy trade completed
[INFO][dex] Buy transaction successful
[INFO][dex] Swap state fetched
[ERROR][dex] Copy trade failed
```

### Key Metrics
- Copy trade success rate
- Average execution time
- Slippage impact
- Pool liquidity levels

## 🔄 Webhook Data Structure

### Input Webhook (from Helius)
```json
{
    "tokenTransfers": [
        {
            "mint": "token_mint_address",
            "fromUserAccount": "from_wallet",
            "toUserAccount": "to_wallet",
            "tokenAmount": "1000000"
        }
    ],
    "nativeTransfers": [
        {
            "fromUserAccount": "from_wallet",
            "toUserAccount": "to_wallet",
            "amount": "1000000000"
        }
    ],
    "signature": "transaction_signature",
    "slot": 12345,
    "timestamp": 1234567890
}
```

### Processed Webhook Data
```typescript
{
    inputMint: 'So11111111111111111111111111111111111111112', // SOL
    outputMint: 'token_mint_address',
    amount: '1000000000', // SOL in lamports
    programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
    poolKey: 'token_mint_address',
    leaderWallet: 'target_wallet_address',
    isBuy: true
}
```

## 🚨 Error Handling

### Common Errors
- **Insufficient SOL balance**: Check bot wallet funding
- **Pool not found**: Token may not be on Pump.fun
- **Slippage exceeded**: Increase slippage tolerance
- **Transaction failed**: Check RPC connection and retry

### Retry Logic
```typescript
const maxRetries = 3;
const retryDelay = 1000; // 1 second

// Automatic retry for transient errors
if (error.message.includes('Blockhash not found')) {
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    // Retry transaction
}
```

## 🔐 Security Considerations

- **Private Key Security**: Store private keys securely
- **Amount Limits**: Set maximum trade amounts
- **Slippage Protection**: Use appropriate slippage tolerance
- **Monitoring**: Monitor bot activity regularly

## 📈 Performance Optimization

- **Connection Pooling**: Reuse RPC connections
- **Caching**: Cache pool state data
- **Batch Processing**: Process multiple webhooks efficiently
- **Priority Fees**: Use appropriate priority fees for fast execution

## 🎉 Success Indicators

- ✅ Webhook reception working
- ✅ Pool state fetching successful
- ✅ Trade calculations accurate
- ✅ Transaction execution successful
- ✅ Copy trades completing within expected timeframes

The bot is now ready for production copy trading using the official Pump Swap SDK!
