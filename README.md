# Pump.fun Copy Trading Bot

A clean, focused webhook server that detects buy transactions from a target wallet via Helius webhooks and executes copy trades using the Pump Swap SDK.

## Features

- **Webhook Server**: Receives Helius webhook payloads
- **Buy Detection**: Analyzes transactions to detect when target wallet is buying tokens
- **Copy Trading**: Executes identical buy transactions using Pump.fun SDK
- **Async Processing**: Responds to webhooks quickly and processes trades asynchronously
- **Error Handling**: Comprehensive logging and error handling

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file with:
   ```
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   TARGET_WALLET_ADDRESS=your_target_wallet_address_here
   BOT_WALLET_SECRET=your_bot_wallet_secret_key_here
   PORT=3000
   ```

3. **Run the Bot**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm run build
   npm start
   ```

## How It Works

1. **Webhook Reception**: Receives Helius webhook payloads at `POST /webhook`
2. **Transaction Analysis**: Extracts token transfers and native transfers from the webhook
3. **Target Detection**: Checks if the target wallet is involved in the transaction
4. **Buy Detection**: Determines if the target wallet is buying tokens (sending SOL, receiving tokens)
5. **Copy Trade Execution**: Uses Pump Swap SDK to execute the same buy transaction
6. **Confirmation**: Waits for transaction confirmation and logs results

## API Endpoints

- `POST /webhook` - Main webhook endpoint for Helius
- `GET /health` - Health check endpoint

## Dependencies

- `@pump-fun/pump-swap-sdk` - Pump.fun trading SDK
- `@solana/web3.js` - Solana blockchain interaction
- `express` - Web server
- `body-parser` - Request parsing
- `bs58` - Base58 encoding for wallet keys
- `dotenv` - Environment variable management

## Configuration

The bot requires three environment variables:

- `SOLANA_RPC_URL`: Solana RPC endpoint
- `TARGET_WALLET_ADDRESS`: Wallet address to copy trades from
- `BOT_WALLET_SECRET`: Bot wallet private key (base58 encoded)

## Error Handling

- Comprehensive logging for all operations
- Graceful error handling for failed transactions
- Retry logic for network operations
- Webhook response sent immediately to prevent timeouts

## Security

- Bot wallet private key should be kept secure
- Use environment variables for sensitive data
- Consider using a dedicated wallet for the bot
- Monitor bot wallet balance and transactions