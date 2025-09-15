const fs = require('fs');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;

// Generate a new bot wallet
const botWallet = Keypair.generate();
const botSecretKey = bs58.encode(botWallet.secretKey);

// Create .env file content
const envContent = `# Solana RPC URL
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Target wallet address to copy trades from
TARGET_WALLET_ADDRESS=your_target_wallet_address_here

# Bot wallet secret key (base58 encoded)
BOT_WALLET_SECRET=${botSecretKey}

# Fixed buy amount in SOL (bot will always buy this amount regardless of target's amount)
FIXED_BUY_AMOUNT=0.1

# Server port (optional, defaults to 3000)
PORT=3000
`;

// Write .env file
fs.writeFileSync('.env', envContent);

console.log('✅ .env file created successfully!');
console.log('');
console.log('🤖 Bot wallet generated:');
console.log('   Public Key:', botWallet.publicKey.toString());
console.log('   Secret Key:', botSecretKey);
console.log('');
console.log('📝 Next steps:');
console.log('1. Edit .env file and replace "your_target_wallet_address_here" with your actual target wallet');
console.log('2. Run: npm start');
console.log('');
console.log('🔒 Keep your secret key secure!');
