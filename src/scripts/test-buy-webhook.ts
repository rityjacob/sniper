import { config } from 'dotenv';
import { dexManager } from '../dex';

// Load environment variables
config();

/**
 * Test the buy webhook that failed
 */
async function testBuyWebhook() {
    console.log('\n🧪 === TESTING BUY WEBHOOK ===');
    
    const testWebhookData = {
        "accountData": [
            {
                "account": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "nativeBalanceChange": -20262269285,
                "tokenBalanceChanges": []
            },
            {
                "account": "2u6ZyeucH2e84iHfTntorAAFGfg6vKuMS49z5LbSaK6Z",
                "nativeBalanceChange": 2039280,
                "tokenBalanceChanges": [
                    {
                        "mint": "9hWxtLoiCKz6BAKGzdCqTCE8w3ZkeMu2RBjiwDd5Vtuy",
                        "rawTokenAmount": {
                            "decimals": 6,
                            "tokenAmount": "19418974012530"
                        },
                        "tokenAccount": "2u6ZyeucH2e84iHfTntorAAFGfg6vKuMS49z5LbSaK6Z",
                        "userAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm"
                    }
                ]
            }
        ],
        "description": "",
        "events": {},
        "fee": 230001,
        "feePayer": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
        "instructions": [],
        "nativeTransfers": [
            {
                "amount": 2039280,
                "fromUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "toUserAccount": "2u6ZyeucH2e84iHfTntorAAFGfg6vKuMS49z5LbSaK6Z"
            },
            {
                "amount": 200000000,
                "fromUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "toUserAccount": "9yMwSPk9mrXSN7yDHUuZurAh1sjbJsfpUqjZ7SvVtdco"
            }
        ],
        "signature": "2tyk5gjkr7io8t1vrN45TkRQzbKkDofvwhegeCh5G5ohGQXszH1oyVmESHrK4MQeeV7x6sUtmq76AXNaB4j4qe63",
        "slot": 362534593,
        "source": "PUMP_AMM",
        "timestamp": 1756172410,
        "tokenTransfers": [
            {
                "fromTokenAccount": "6GZY9K1uqQCazQ3iQvnSQYEumAjyGoQqh58VHYhrw61G",
                "fromUserAccount": "GfyvVT78eH9mDb2QAMZ8jwe6YmRgQHFtCVf3JBzDPNwL",
                "mint": "9hWxtLoiCKz6BAKGzdCqTCE8w3ZkeMu2RBjiwDd5Vtuy",
                "toTokenAccount": "2u6ZyeucH2e84iHfTntorAAFGfg6vKuMS49z5LbSaK6Z",
                "toUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "tokenAmount": 19418974.01253,
                "tokenStandard": "Fungible"
            },
            {
                "fromTokenAccount": "CsC8RP9RENePYwJUW34Gs6Te4Cf78KJYJBL2Z3qzc9md",
                "fromUserAccount": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
                "mint": "So11111111111111111111111111111111111111112",
                "toTokenAccount": "2rPBHopg3PwwQVyZtGHRpm24HUhBhyPMqPRGe81Y9x5m",
                "toUserAccount": "GfyvVT78eH9mDb2QAMZ8jwe6YmRgQHFtCVf3JBzDPNwL",
                "tokenAmount": 20.040000002,
                "tokenStandard": "Fungible"
            }
        ],
        "transactionError": null,
        "type": "SWAP"
    };

    // Convert to PumpFunWebhook format
    const webhookData = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: '9hWxtLoiCKz6BAKGzdCqTCE8w3ZkeMu2RBjiwDd5Vtuy',
        amount: '2039280',
        accounts: testWebhookData.accountData.map(acc => acc.account),
        programId: 'troY36YiPGqMyAYCNbEqYCdN2tb91Zf7bHcQt7KUi61',
        data: 'test-data',
        source: 'PUMP_AMM',
        signature: testWebhookData.signature,
        slot: testWebhookData.slot,
        blockTime: testWebhookData.timestamp,
        feePayer: testWebhookData.feePayer,
        transaction: {
            signature: testWebhookData.signature,
            slot: testWebhookData.slot,
            blockTime: testWebhookData.timestamp,
            meta: {
                err: null,
                fee: testWebhookData.fee,
                preBalances: [],
                postBalances: [],
                preTokenBalances: [],
                postTokenBalances: [],
                logMessages: []
            },
            transaction: {
                message: {
                    accountKeys: testWebhookData.accountData.map(acc => acc.account),
                    instructions: []
                }
            }
        }
    };

    console.log('🎯 Target Wallet:', process.env.TARGET_WALLET_ADDRESS);
    console.log('📊 Webhook Data:', {
        inputMint: webhookData.inputMint,
        outputMint: webhookData.outputMint,
        amount: webhookData.amount,
        feePayer: webhookData.feePayer,
        source: webhookData.source
    });

    try {
        console.log('\n🚀 Testing webhook processing...');
        const fixedBuyAmount = parseFloat(process.env.FIXED_BUY_AMOUNT || '0.02');
        const signature = await dexManager.processLeaderBuyWebhook(webhookData, fixedBuyAmount);
        console.log('✅ SUCCESS! Trade executed with signature:', signature);
    } catch (error) {
        console.log('❌ FAILED! Error:', error instanceof Error ? error.message : String(error));
    }

    console.log('\n=== END TEST ===\n');
}

if (require.main === module) {
    testBuyWebhook().catch(console.error);
}
