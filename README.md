# Sniper - High-Performance Copy Trading Bot

A streamlined copy trading bot for Solana that receives webhooks from Helius and executes buy trades automatically with **optimized Helius RPC integration** for maximum speed and reliability.

## Features

- **🚀 Helius RPC Integration**: Optimized for maximum transaction speed using Helius RPC endpoints
- **⚡ Enhanced Transaction Processing**: Compute unit optimization (200k CU limit) and priority fees
- **🎯 Helius Enhanced Transaction API**: Advanced transaction confirmation and monitoring
- **Webhook Integration**: Receives transaction data from Helius webhooks
- **Copy Trading**: Automatically copies buy transactions from a target wallet
- **Jupiter DEX Integration**: Uses Jupiter for optimal swap execution with Helius optimizations
- **Console Logging**: All logs are output to console for easy monitoring
- **Health Check**: Built-in health endpoint for monitoring

## Setup

### Environment Variables

Set these environment variables in your Render deployment:

- `TARGET_WALLET_ADDRESS`: The wallet address to copy trades from
- `WALLET_PRIVATE_KEY`: Your bot's wallet private key
- `SOLANA_RPC_URL`: **REQUIRED** - Your Helius RPC endpoint with API key
- `SOLANA_WS_URL`: **REQUIRED** - Your Helius WebSocket endpoint with API key

**Important**: Both RPC URLs are required. The bot will not work without proper Helius endpoints.

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
3. **Ultra-Fast Execution Pipeline**: 
   - **Fresh Blockhash**: Fetches latest blockhash before building transaction
   - **Dynamic Priority Fees**: Uses `getRecentPrioritizationFees` for median CU price + 10-30%
   - **Compute Budget Instructions**: Adds 200k CU limit + dynamic price instructions
   - **Optional Simulation**: Validates transaction before sending (can be skipped for ultra-low latency)
   - **Skip Preflight**: Uses `skipPreflight: true` for maximum speed
   - **Fast Confirmation**: Uses `getSignatureStatuses` with Enhanced Transaction API fallback
4. **Copy Execution**: Executes the same buy transaction using Jupiter DEX
5. **Logging**: All actions are logged to console for monitoring

### Helius Optimization Features

- **🔄 Dynamic Priority Fees**: Uses `getRecentPrioritizationFees` for median CU price + 10-30% competitive edge
- **📡 Fresh Blockhash**: Fetches latest blockhash before each transaction for maximum validity
- **⚡ Compute Budget Instructions**: Proper 200k CU limit + dynamic price instructions
- **🎯 Optional Simulation**: Transaction validation (can be skipped for ultra-low latency)
- **🚀 Skip Preflight**: Uses `skipPreflight: true` for maximum transaction speed
- **🔍 Fast Confirmation**: Dual strategy using `getSignatureStatuses` + Enhanced Transaction API
- **🔄 Intelligent Retry**: Smart retry with 50ms delays for faster execution
- **📊 Real-time Metrics**: Logs confirmation times and CU usage for optimization

## API Endpoints

- `POST /webhook`: Receives Helius webhook data
- `GET /health`: Health check endpoint

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the production server
npm start

# Development mode with auto-rebuild
npm run dev
```

## Project Structure

```
src/
├── config.ts          # Configuration and environment variables
├── dex.ts             # Jupiter DEX integration with Helius optimizations
├── server.ts          # Express server and webhook handlers
├── wallet.ts          # Wallet management and transaction pipeline
└── utils/
    └── logger.ts      # Logging utilities

dist/                  # Compiled JavaScript output
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
