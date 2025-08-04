# Sniper - Simple Copy Trading Bot

A streamlined copy trading bot for Solana that receives webhooks from Helius and executes buy trades automatically.

## Features

- **Webhook Integration**: Receives transaction data from Helius webhooks
- **Copy Trading**: Automatically copies buy transactions from a target wallet
- **Jupiter DEX Integration**: Uses Jupiter for optimal swap execution
- **Console Logging**: All logs are output to console for easy monitoring
- **Health Check**: Built-in health endpoint for monitoring

## Setup

### Environment Variables

Set these environment variables in your Render deployment:

- `TARGET_WALLET_ADDRESS`: The wallet address to copy trades from
- `WALLET_PRIVATE_KEY`: Your bot's wallet private key
- `SOLANA_RPC_URL`: Solana RPC endpoint (defaults to mainnet)
- `HELIUS_API_KEY`: Your Helius API key (for webhook setup)

### Helius Webhook Configuration

1. Go to your Helius dashboard
2. Create a new webhook with these settings:
   - **Network**: mainnet
   - **Webhook Type**: enhanced
   - **Transaction Type(s)**: SWAP
   - **Webhook URL**: `https://your-app-name.onrender.com/webhook`
   - **Account Addresses**: Add your target wallet address

## How It Works

1. **Webhook Reception**: The bot receives SWAP events from Helius
2. **Target Detection**: Checks if the target wallet is buying tokens
3. **Copy Execution**: Executes the same buy transaction using Jupiter DEX
4. **Logging**: All actions are logged to console for monitoring

## API Endpoints

- `POST /webhook`: Receives Helius webhook data
- `GET /health`: Health check endpoint

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start

# Development mode with auto-rebuild
npm run dev
```

## Deployment

The bot is designed to run on Render. Simply connect your GitHub repository and Render will automatically build and deploy the application.

## Logging

All logs are output to console and will be visible in your Render dashboard. The bot logs:
- Webhook reception
- Transaction processing
- Swap execution
- Errors and warnings

## Security Notes

- Keep your private keys secure
- Monitor your bot's activity regularly
- Set appropriate transaction limits
- Test thoroughly before using real funds
