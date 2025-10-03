# Deployment Guide for Render

## Prerequisites

1. **Helius Account**: Sign up at [helius.xyz](https://helius.xyz) and get your API key
2. **Solana Wallet**: Create a wallet for your bot with some SOL for trading
3. **Target Wallet**: The wallet address you want to copy trades from

## Environment Variables

Set these environment variables in your Render dashboard:

### Required Variables:
- `TARGET_WALLET_ADDRESS`: The wallet address to copy trades from
- `WALLET_PRIVATE_KEY`: Your bot's wallet private key (base58 encoded)
- `SOLANA_RPC_URL`: Your Helius RPC endpoint (e.g., `https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY`)
- `SOLANA_WS_URL`: Your Helius WebSocket endpoint (e.g., `wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY`)

### Optional Variables:
- `FIXED_SOL_PER_TRADE`: Fixed SOL amount per trade (default: 0.02)
- `MIN_SOL_BALANCE`: Minimum SOL balance to maintain (default: 0.0001)
- `MAX_SOL_PER_TRADE`: Maximum SOL per trade (default: 0.1)
- `PERCENTAGE_OF_TARGET_TRADE`: Percentage of target trade to copy (default: 1)

## Deployment Steps

1. **Connect Repository**: Connect your GitHub repository to Render
2. **Create Web Service**: Choose "Web Service" and select your repository
3. **Configure Service**:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. **Set Environment Variables**: Add all required environment variables
5. **Deploy**: Click "Deploy" and wait for deployment to complete

## Helius Webhook Configuration

1. Go to your Helius dashboard
2. Create a new webhook with these settings:
   - **Network**: mainnet
   - **Webhook Type**: enhanced
   - **Transaction Type(s)**: SWAP
   - **Webhook URL**: `https://your-app-name.onrender.com/webhook`
   - **Account Addresses**: Add your target wallet address

## Monitoring

- **Health Check**: Visit `https://your-app-name.onrender.com/health`
- **Logs**: Check Render dashboard logs for real-time monitoring
- **Metrics**: Monitor wallet balance and transaction success rates

## Security Notes

- Keep your private keys secure
- Monitor your bot's activity regularly
- Set appropriate transaction limits
- Test thoroughly before using real funds

## Troubleshooting

- Check logs in Render dashboard for errors
- Verify all environment variables are set correctly
- Ensure your Helius webhook is configured properly
- Monitor wallet balance to ensure sufficient funds
