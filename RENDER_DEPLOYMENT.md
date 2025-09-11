# Render Deployment Guide

This guide will help you deploy the Pump.fun Sniper Bot to Render as a webhook server.

## Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **Solana Wallet**: A wallet with SOL for trading
4. **RPC Endpoint**: A Solana RPC endpoint (can use public or private)

## Deployment Steps

### 1. Connect Repository to Render

1. Go to [render.com](https://render.com) and sign in
2. Click "New +" and select "Web Service"
3. Connect your GitHub repository
4. Select the repository containing this code

### 2. Configure Environment Variables

In Render, add these environment variables:

```bash
# Required Environment Variables
NODE_ENV=production
PORT=10000

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Wallet Configuration (IMPORTANT: Keep these secure!)
WALLET_PRIVATE_KEY=your_private_key_here
TARGET_WALLET_ADDRESS=target_wallet_address_here

# Trading Configuration
FIXED_BUY_AMOUNT=0.1
MIN_SOL_BALANCE=0.01
MAX_SOL_PER_TRADE=1.0
PERCENTAGE_OF_TARGET_TRADE=1

# Pump.fun Configuration
PUMP_FUN_PROGRAM_ID=troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61

# Optional: Target Token Mint (for status endpoint)
TARGET_TOKEN_MINT=your_target_token_mint_here
```

### 3. Build and Deploy Settings

- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`

### 4. Deploy

Click "Create Web Service" and wait for the deployment to complete.

## Webhook Endpoints

Once deployed, your bot will be available at:

```
https://your-app-name.onrender.com
```

### Available Endpoints

1. **Health Check**: `GET /health`
   - Returns bot status and health information

2. **Status**: `GET /status`
   - Returns bot configuration and balance information

3. **Webhook (Default Amount)**: `POST /webhook/pump-fun`
   - Receives Pump.fun webhooks and executes trades with default amount

4. **Webhook (Custom Amount)**: `POST /webhook/pump-fun/:amount`
   - Receives Pump.fun webhooks and executes trades with custom SOL amount

## Webhook Configuration

### Setting up Webhook URL

Configure your webhook source to send POST requests to:

```
https://your-app-name.onrender.com/webhook/pump-fun
```

### Webhook Payload Format

The webhook should send JSON data in this format:

```json
{
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "TokenMintAddressHere",
  "amount": "1000000000",
  "accounts": ["WalletAddress", "TokenAccount1", "TokenAccount2"],
  "programId": "troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61",
  "data": "base64EncodedInstructionData",
  "transaction": {
    "signature": "tx-signature",
    "slot": 123456,
    "blockTime": 1234567890,
    "meta": {
      "logMessages": ["Program troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61 invoke"],
      "postTokenBalances": [
        {
          "owner": "leader-wallet-address",
          "mint": "TokenMintAddress",
          "uiTokenAmount": { "amount": "1000000" }
        }
      ]
    },
    "transaction": {
      "message": {
        "accountKeys": ["leader-wallet-address", "pool-address"],
        "instructions": [
          {
            "programId": "troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61"
          }
        ]
      }
    }
  }
}
```

## Monitoring

### Health Check

Monitor your bot's health:

```bash
curl https://your-app-name.onrender.com/health
```

### Status Check

Check bot status and configuration:

```bash
curl https://your-app-name.onrender.com/status
```

### Logs

View logs in Render dashboard:
1. Go to your service in Render
2. Click on "Logs" tab
3. Monitor real-time logs for webhook processing

## Security Considerations

1. **Private Key**: Never commit your private key to the repository
2. **Environment Variables**: Use Render's environment variable feature
3. **RPC Endpoint**: Consider using a private RPC endpoint for better performance
4. **Rate Limiting**: Monitor webhook frequency to prevent abuse

## Troubleshooting

### Common Issues

1. **Build Failures**: Check that all dependencies are in package.json
2. **Startup Errors**: Verify environment variables are set correctly
3. **Webhook Failures**: Check webhook payload format and bot logs
4. **Transaction Failures**: Verify wallet has sufficient SOL balance

### Debug Commands

Test webhook locally:

```bash
# Start local server
npm run webhook

# Test webhook endpoint
curl -X POST http://localhost:3000/webhook/pump-fun \
  -H "Content-Type: application/json" \
  -d '{"inputMint":"So11111111111111111111111111111111111111112","outputMint":"test","amount":"1000000000","programId":"troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61"}'
```

## Cost Considerations

- **Free Tier**: Limited to 750 hours/month
- **Paid Plans**: Start at $7/month for unlimited usage
- **RPC Costs**: Consider private RPC endpoint for high-frequency trading

## Support

For issues with:
- **Render Deployment**: Check Render documentation
- **Bot Logic**: Check logs and this repository
- **Webhook Integration**: Verify payload format and endpoint URL
