import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Debug webhook data to understand transaction direction and target wallet involvement
 */
export function debugWebhookData(webhookData: any) {
    console.log('\n🔍 === WEBHOOK DEBUG ANALYSIS ===');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('🔍 Signature:', webhookData.signature?.slice(0, 8) + '...' || 'N/A');
    console.log('📊 Type:', webhookData.type || 'Unknown');
    console.log('🎯 Source:', webhookData.source || 'Unknown');
    
    const targetWallet = process.env.TARGET_WALLET_ADDRESS;
    console.log('🎯 Target Wallet:', targetWallet || 'NOT SET');
    
    // Analyze token transfers
    const tokenTransfers = webhookData.tokenTransfers || [];
    const nativeTransfers = webhookData.nativeTransfers || [];
    
    console.log('\n📦 TOKEN TRANSFERS:', tokenTransfers.length);
    tokenTransfers.forEach((transfer: any, index: number) => {
        console.log(`  ${index + 1}. Token: ${transfer.mint || 'Unknown'}`);
        console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
        console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
        console.log(`     Amount: ${transfer.tokenAmount || 'N/A'}`);
        console.log(`     From Token Account: ${transfer.fromTokenAccount || 'N/A'}`);
        console.log(`     To Token Account: ${transfer.toTokenAccount || 'N/A'}`);
        
        // Check if target wallet is involved
        if (targetWallet) {
            const isFromTarget = transfer.fromUserAccount === targetWallet || transfer.fromTokenAccount === targetWallet;
            const isToTarget = transfer.toUserAccount === targetWallet || transfer.toTokenAccount === targetWallet;
            
            if (isFromTarget) {
                console.log(`     🟡 TARGET WALLET IS SELLING THIS TOKEN`);
            }
            if (isToTarget) {
                console.log(`     🟢 TARGET WALLET IS BUYING THIS TOKEN`);
            }
        }
        console.log('');
    });
    
    console.log('💰 NATIVE TRANSFERS (SOL):', nativeTransfers.length);
    nativeTransfers.forEach((transfer: any, index: number) => {
        const amountInSol = transfer.amount ? (transfer.amount / 1e9).toFixed(6) : 'N/A';
        console.log(`  ${index + 1}. ${amountInSol} SOL`);
        console.log(`     From: ${transfer.fromUserAccount || 'N/A'}`);
        console.log(`     To: ${transfer.toUserAccount || 'N/A'}`);
        
        // Check if target wallet is involved
        if (targetWallet) {
            const isFromTarget = transfer.fromUserAccount === targetWallet;
            const isToTarget = transfer.toUserAccount === targetWallet;
            
            if (isFromTarget) {
                console.log(`     🔴 TARGET WALLET IS SPENDING SOL`);
            }
            if (isToTarget) {
                console.log(`     🟢 TARGET WALLET IS RECEIVING SOL`);
            }
        }
        console.log('');
    });
    
    // Determine transaction direction
    console.log('🔄 TRANSACTION DIRECTION ANALYSIS:');
    if (targetWallet && tokenTransfers.length > 0) {
        const targetBuying = tokenTransfers.some((t: any) => 
            t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
        );
        
        const targetSelling = tokenTransfers.some((t: any) => 
            t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
        );
        
        if (targetBuying && !targetSelling) {
            console.log('  ✅ BUY TRANSACTION - Target wallet is buying tokens');
            const receivedToken = tokenTransfers.find((t: any) => 
                t.toUserAccount === targetWallet || t.toTokenAccount === targetWallet
            );
            console.log(`     Token: ${receivedToken?.mint || 'unknown'}`);
            console.log(`     Amount: ${receivedToken?.tokenAmount || 'unknown'}`);
        } else if (targetSelling && !targetBuying) {
            console.log('  ❌ SELL TRANSACTION - Target wallet is selling tokens');
            const soldToken = tokenTransfers.find((t: any) => 
                t.fromUserAccount === targetWallet || t.fromTokenAccount === targetWallet
            );
            console.log(`     Token: ${soldToken?.mint || 'unknown'}`);
            console.log(`     Amount: ${soldToken?.tokenAmount || 'unknown'}`);
        } else if (targetBuying && targetSelling) {
            console.log('  ⚠️  COMPLEX TRANSACTION - Target wallet is both buying and selling');
        } else {
            console.log('  ❓ UNKNOWN - Target wallet not involved in token transfers');
        }
    } else {
        console.log('  ❓ Cannot determine direction - no target wallet or token transfers');
    }
    
    console.log('\n=== END DEBUG ANALYSIS ===\n');
}

/**
 * Test with the webhook data you provided
 */
if (require.main === module) {
    const testWebhookData = {
        "accountData": [
            {
                "account": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "nativeBalanceChange": 11143002859,
                "tokenBalanceChanges": []
            },
            {
                "account": "2maxB6UADbLmaYYGAAGXZNwTALeTN3B4KkG26fEcXV7J",
                "nativeBalanceChange": 0,
                "tokenBalanceChanges": [
                    {
                        "mint": "44sVpouhWHXzADVsVUo863tvgmaw6LNQo25fYRs1pump",
                        "rawTokenAmount": {
                            "decimals": 6,
                            "tokenAmount": "-3666988222932"
                        },
                        "tokenAccount": "2maxB6UADbLmaYYGAAGXZNwTALeTN3B4KkG26fEcXV7J",
                        "userAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm"
                    }
                ]
            },
            {
                "account": "98FTLD2zwYrmGYfCnGYEBeMaY7mShE9TpeV9zjaFEb3c",
                "nativeBalanceChange": 0,
                "tokenBalanceChanges": [
                    {
                        "mint": "44sVpouhWHXzADVsVUo863tvgmaw6LNQo25fYRs1pump",
                        "rawTokenAmount": {
                            "decimals": 6,
                            "tokenAmount": "3666988222932"
                        },
                        "tokenAccount": "98FTLD2zwYrmGYfCnGYEBeMaY7mShE9TpeV9zjaFEb3c",
                        "userAccount": "DmyGpMBR5bVLVViypBXAPX5D5FW6GaVzMWEx7sF8i6rT"
                    }
                ]
            }
        ],
        "description": "",
        "events": {},
        "fee": 7505001,
        "feePayer": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
        "instructions": [],
        "nativeTransfers": [
            {
                "amount": 113463653,
                "fromUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "toUserAccount": "9yMwSPk9mrXSN7yDHUuZurAh1sjbJsfpUqjZ7SvVtdco"
            },
            {
                "amount": 11263971513,
                "fromUserAccount": "dgo73zJsFYnGsuWTccFTUT371y9mRbs7ErdcHbmGWbP",
                "toUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm"
            }
        ],
        "signature": "5PQ9Ucqg64uZihjc3aJ47MpkLdYktDphsReR5EuUyEr5unJsu2K8Uj3SFZWiEznvN83ZgNUr5oWF7wsUPe2Ugco",
        "slot": 362536673,
        "source": "PUMP_AMM",
        "timestamp": 1756173223,
        "tokenTransfers": [
            {
                "fromTokenAccount": "2maxB6UADbLmaYYGAAGXZNwTALeTN3B4KkG26fEcXV7J",
                "fromUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "mint": "44sVpouhWHXzADVsVUo863tvgmaw6LNQo25fYRs1pump",
                "toTokenAccount": "98FTLD2zwYrmGYfCnGYEBeMaY7mShE9TpeV9zjaFEb3c",
                "toUserAccount": "DmyGpMBR5bVLVViypBXAPX5D5FW6GaVzMWEx7sF8i6rT",
                "tokenAmount": 3666988.222932,
                "tokenStandard": "Fungible"
            },
            {
                "fromTokenAccount": "J9ETcDLLwcFtQBaRcnAo4EKfnW4WEVNPXYPHmFTrHCmb",
                "fromUserAccount": "DmyGpMBR5bVLVViypBXAPX5D5FW6GaVzMWEx7sF8i6rT",
                "mint": "So11111111111111111111111111111111111111112",
                "toTokenAccount": "dgo73zJsFYnGsuWTccFTUT371y9mRbs7ErdcHbmGWbP",
                "toUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "tokenAmount": 11.263971513,
                "tokenStandard": "Fungible"
            }
        ],
        "transactionError": null,
        "type": "SWAP"
    };
    
    debugWebhookData(testWebhookData);
}
