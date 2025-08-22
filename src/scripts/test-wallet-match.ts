#!/usr/bin/env ts-node

/**
 * Test script to check wallet matching
 */

// The transaction signer from Solscan
const TRANSACTION_SIGNER = 'gake';

// The target wallet from your logs
const TARGET_WALLET = 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';

console.log('🔍 === WALLET MATCHING TEST ===');
console.log('Transaction Signer (from Solscan):', TRANSACTION_SIGNER);
console.log('Target Wallet (from logs):', TARGET_WALLET);
console.log('Match:', TRANSACTION_SIGNER === TARGET_WALLET);

if (TRANSACTION_SIGNER !== TARGET_WALLET) {
    console.log('\n❌ WALLET MISMATCH DETECTED!');
    console.log('The transaction signer does not match your target wallet.');
    console.log('This means the webhook is for a different wallet than the one you\'re monitoring.');
    console.log('\nPossible solutions:');
    console.log('1. Update TARGET_WALLET_ADDRESS environment variable to:', TRANSACTION_SIGNER);
    console.log('2. Or ensure your webhook is configured to monitor the correct wallet');
} else {
    console.log('\n✅ Wallets match!');
}

console.log('\n=== END TEST ===\n');
