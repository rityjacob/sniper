# Universal Webhook Bot

This bot has been modified to receive **ALL** webhooks from Helius and intelligently filter for buy transactions to trigger Pump.fun trades.

## How It Works

1. **Receives ALL Webhooks**: The bot now accepts all transaction types from Helius without initial filtering
2. **Displays Webhook**: Complete webhook payload is logged for debugging and monitoring
3. **Analyzes Transactions**: Each transaction is analyzed to determine if it's a buy transaction
4. **Triggers Bot**: If a buy transaction is detected, the bot executes a trade through Pump.fun AMM
5. **Skips Non-Buy**: All other transactions are logged but skipped

## Buy Transaction Detection

A transaction is considered a "buy" if:
- The target wallet is **receiving tokens** (in `tokenTransfers`)
- The target wallet is **sending SOL** (in `nativeTransfers`)

This ensures we only copy actual buy transactions, not sells or other transfers.

## Configuration

### Environment Variables

```bash
# Required
TARGET_WALLET_ADDRESS=your_target_wallet_address
SOLANA_RPC_URL=your_rpc_url
PRIVATE_KEY=your_private_key

# Optional (defaults to 0.1 SOL)
FIXED_BUY_AMOUNT=0.1

# Optional (for testing)
WEBHOOK_URL=http://localhost:3000/webhook
```

### Helius Webhook Configuration

Configure your Helius webhook with:
- **Transaction Type**: `SWAP` (or any type - the bot will filter)
- **Webhook URL**: Your server's `/webhook` endpoint
- **Account Filter**: Your target wallet address

## Usage

### Start the Server

```bash
# Development
npm run webhook

# Production
npm run build
npm start
```

### Test the Webhook

```bash
# Test universal webhook functionality
npm run test-universal
```

### Check Status

```bash
# Health check
curl http://localhost:3000/health

# Status endpoint
curl http://localhost:3000/status
```

## API Endpoints

- `POST /webhook` - Main webhook endpoint (receives all Helius webhooks)
- `POST /test-webhook` - Test endpoint for webhook connectivity
- `GET /health` - Health check
- `GET /status` - Bot status and configuration
- `GET /test` - Basic connectivity test

## Logging

The bot provides detailed logging:

```
🔔 === WEBHOOK RECEIVED ===
📅 Timestamp: 2024-01-01T12:00:00.000Z
📋 Event Type: SWAP
🔍 Signature: abc123...
📊 Payload Size: 1234 characters

📋 COMPLETE WEBHOOK PAYLOAD:
{
  "type": "SWAP",
  "signature": "abc123...",
  ...
}

🔍 ANALYZING TRANSACTION: abc123...
   Type: SWAP
   Program: some_program_id
   🎯 Target Wallet: your_target_wallet
   📦 Token Transfers: 1
   💰 Native Transfers: 1
   📥 Target Receiving Tokens: true
   💸 Target Sending SOL: true
   🟢 BUY CONFIRMED:
      Token: token_mint_address
      Amount: 0.100000 SOL

🟢 BUY TRANSACTION DETECTED - TRIGGERING BOT
```

## Example Webhook Response

```json
{
  "success": true,
  "message": "Processed 1 transaction(s), 1 buy transaction(s)",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "summary": {
    "totalTransactions": 1,
    "processedTransactions": 1,
    "buyTransactions": 1
  }
}
```

## Troubleshooting

### No Buy Transactions Detected

1. Check that `TARGET_WALLET_ADDRESS` is set correctly
2. Verify the target wallet is actually buying tokens (receiving tokens + sending SOL)
3. Check webhook logs for transaction analysis details

### Webhook Not Receiving Data

1. Verify Helius webhook configuration
2. Check server logs for incoming requests
3. Test with `npm run test-universal`

### Trade Execution Fails

1. Check SOL balance is sufficient for `FIXED_BUY_AMOUNT` + fees
2. Verify RPC connection is working
3. Check private key is valid and has sufficient SOL

## Security Notes

- The bot only executes trades when it detects the target wallet is buying
- All webhook data is logged for transparency
- Fixed buy amount prevents excessive spending
- Private keys should be kept secure and not committed to version control

## Monitoring

Monitor the bot through:
- Console logs for real-time transaction analysis
- `/status` endpoint for configuration verification
- `/health` endpoint for server status
- Webhook response summaries for transaction counts
