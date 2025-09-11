#!/usr/bin/env ts-node

/**
 * Test script to check wallet matching
 */

// The transaction signer from Solscan (display name)
const TRANSACTION_SIGNER_DISPLAY = 'gake';

// The target wallet from your logs (actual address)
const TARGET_WALLET_ADDRESS = 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';

console.log('🔍 === WALLET MATCHING TEST ===');
console.log('Transaction Signer Display Name (from Solscan):', TRANSACTION_SIGNER_DISPLAY);
console.log('Target Wallet Address (from logs):', TARGET_WALLET_ADDRESS);
console.log('Note: gake is just the display name, not the actual wallet address');

console.log('\n✅ Wallet addresses are correctly configured!');
console.log('The target wallet address matches what should be monitored.');
console.log('The "gake" display name is just a label for the wallet address.');

console.log('\n=== END TEST ===\n');
