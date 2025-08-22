#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';

// Constants
const PUMP_FUN_PROGRAM_ID = new PublicKey('troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Debug webhook data structure and transaction analysis
 */
export function debugWebhookData(webhookData: any) {
    console.log('\n🔍 === WEBHOOK DEBUG ANALYSIS ===');
    
    // Basic webhook structure
    console.log('📋 Basic Structure:');
    console.log('  - Has tokenTransfers:', !!webhookData.tokenTransfers);
    console.log('  - Has nativeTransfers:', !!webhookData.nativeTransfers);
    console.log('  - Has instructions:', !!webhookData.instructions);
    console.log('  - Has accountData:', !!webhookData.accountData);
    console.log('  - Has transaction:', !!webhookData.transaction);
    
    // Transaction type analysis
    console.log('\n📊 Transaction Analysis:');
    console.log('  - Type:', webhookData.type || 'unknown');
    console.log('  - Program ID:', webhookData.programId || 'unknown');
    console.log('  - Signature:', webhookData.signature?.slice(0, 8) + '...' || 'unknown');
    
    // Pump.fun detection
    const isPumpFun = webhookData.programId === PUMP_FUN_PROGRAM_ID.toString() || 
                     webhookData.source === 'PUMP_AMM' ||
                     (webhookData.instructions && webhookData.instructions.some((inst: any) => 
                         inst.programId === PUMP_FUN_PROGRAM_ID.toString()
                     ));
    
    console.log('  - Is Pump.fun:', isPumpFun);
    
    // Token transfers analysis
    if (webhookData.tokenTransfers && webhookData.tokenTransfers.length > 0) {
        console.log('\n📦 Token Transfers:');
        webhookData.tokenTransfers.forEach((transfer: any, index: number) => {
            console.log(`  ${index + 1}. ${transfer.mint || 'Unknown Token'}`);
            console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
            console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
            console.log(`     Amount: ${transfer.tokenAmount || 'N/A'}`);
            console.log(`     Token Account From: ${transfer.fromTokenAccount || 'N/A'}`);
            console.log(`     Token Account To: ${transfer.toTokenAccount || 'N/A'}`);
        });
    }
    
    // Native transfers analysis
    if (webhookData.nativeTransfers && webhookData.nativeTransfers.length > 0) {
        console.log('\n💰 Native Transfers (SOL):');
        webhookData.nativeTransfers.forEach((transfer: any, index: number) => {
            const amountInSol = transfer.amount ? (transfer.amount / 1e9).toFixed(6) : 'N/A';
            console.log(`  ${index + 1}. ${amountInSol} SOL`);
            console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
            console.log(`     To: ${transfer.fromUserAccount || 'N/A'}`);
            console.log(`     Amount (lamports): ${transfer.amount || 'N/A'}`);
        });
    }
    
    // Target wallet analysis
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    if (targetWallet) {
        console.log('\n🎯 Target Wallet Analysis:');
        console.log('  - Target Wallet:', targetWallet);
        
        const tokenTransfers = webhookData.tokenTransfers || [];
        const nativeTransfers = webhookData.nativeTransfers || [];
        
        // Check if target wallet is involved in token transfers
        const targetInTokenTransfers = tokenTransfers.some((t: any) => 
            t.fromUserAccount === targetWallet || t.toUserAccount === targetWallet ||
            t.fromTokenAccount === targetWallet || t.toTokenAccount === targetWallet
        );
        
        // Check if target wallet is involved in native transfers
        const targetInNativeTransfers = nativeTransfers.some((t: any) => 
            t.fromUserAccount === targetWallet || t.toUserAccount === targetWallet
        );
        
        console.log('  - Involved in Token Transfers:', targetInTokenTransfers);
        console.log('  - Involved in Native Transfers:', targetInNativeTransfers);
        
        if (targetInTokenTransfers) {
            // Determine if target is buying or selling
            const targetBuying = tokenTransfers.some((t: any) => 
                t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
            );
            
            const targetSelling = tokenTransfers.some((t: any) => 
                t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
            );
            
            console.log('  - Target Buying:', targetBuying);
            console.log('  - Target Selling:', targetSelling);
            
            if (targetBuying) {
                const receivedToken = tokenTransfers.find((t: any) => 
                    t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
                );
                console.log('  - Received Token:', receivedToken?.mint || 'unknown');
            }
            
            if (targetSelling) {
                const soldToken = tokenTransfers.find((t: any) => 
                    t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
                );
                console.log('  - Sold Token:', soldToken?.mint || 'unknown');
            }
        }
    }
    
    // Buy/Sell determination
    console.log('\n🔄 Buy/Sell Determination:');
    const tokenTransfers = webhookData.tokenTransfers || [];
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    
    if (targetWallet && tokenTransfers.length > 0) {
        const targetBuying = tokenTransfers.some((t: any) => 
            t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
        );
        
        const targetSelling = tokenTransfers.some((t: any) => 
            t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
        );
        
        if (targetBuying) {
            const receivedToken = tokenTransfers.find((t: any) => 
                t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
            );
            console.log('  - Transaction Type: BUY');
            console.log('  - Input Mint: WSOL (So11111111111111111111111111111111111111112)');
            console.log('  - Output Mint:', receivedToken?.mint || 'unknown');
        } else if (targetSelling) {
            const soldToken = tokenTransfers.find((t: any) => 
                t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
            );
            console.log('  - Transaction Type: SELL');
            console.log('  - Input Mint:', soldToken?.mint || 'unknown');
            console.log('  - Output Mint: WSOL (So11111111111111111111111111111111111111112)');
        } else {
            console.log('  - Transaction Type: UNKNOWN');
        }
    }
    
    console.log('\n=== END DEBUG ANALYSIS ===\n');
}

/**
 * Test the debug function with sample data
 */
if (require.main === module) {
    // Sample webhook data for testing
    const sampleWebhookData = {
        type: 'SWAP',
        programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
        signature: '2QTNwmHk...',
        tokenTransfers: [
            {
                mint: 'Aia5bA9duTSFK5t4mjzeueLs5cV3LzgDMR6QUYk6pump',
                fromUserAccount: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm',
                toUserAccount: 'Pump.fun AMM Pool',
                tokenAmount: '29597643122728'
            }
        ],
        nativeTransfers: [
            {
                fromUserAccount: 'Pump.fun AMM Pool',
                toUserAccount: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm',
                amount: '7000000001'
            }
        ]
    };
    
    // Set target wallet for testing
    process.env.TARGET_WALLET_ADDRESS = 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';
    
    debugWebhookData(sampleWebhookData);
}
