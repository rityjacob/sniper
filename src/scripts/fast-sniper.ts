import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { RPC_URL, DEX_CONFIG, TRANSACTION_CONFIG } from '../config';
import { walletManager } from '../wallet';
import { logger } from '../utils/logger';
import fetch from 'node-fetch';
import WebSocket from 'ws';

class FastSniper {
    private ws: WebSocket;
    private connection: Connection;
    private isRunning: boolean = false;
    private lastTradeTime: number = 0;

    constructor() {
        this.connection = new Connection(RPC_URL, 'processed');
        this.ws = new WebSocket(process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com');
        this.setupWebSocket();
    }

    private setupWebSocket() {
        this.ws.on('open', () => {
            console.log('🚀 Fast Sniper WebSocket connected!');
            
            // Subscribe to target wallet with processed commitment for fastest detection
            const subscribeMessage = {
                jsonrpc: "2.0",
                id: 1,
                method: "accountSubscribe",
                params: [
                    process.env.TARGET_WALLET_ADDRESS,
                    {
                        encoding: "jsonParsed",
                        commitment: "processed"
                    }
                ]
            };
            
            this.ws.send(JSON.stringify(subscribeMessage));
        });

        this.ws.on('message', async (data) => {
            if (!this.isRunning) return;
            
            try {
                const parsed = JSON.parse(data.toString());
                
                if (parsed?.params?.result?.value) {
                    const accountData = parsed.params.result.value;
                    
                    // Check for token program interactions
                    if (accountData.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                        await this.handleTokenTransaction(accountData);
                    }
                }
            } catch (error) {
                console.error('❌ WebSocket message error:', error);
            }
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
        });

        this.ws.on('close', () => {
            console.log('🔌 WebSocket closed, attempting reconnect...');
            setTimeout(() => {
                this.ws = new WebSocket(process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com');
                this.setupWebSocket();
            }, 1000);
        });
    }

    private async handleTokenTransaction(accountData: any) {
        try {
            // Extract token info quickly
            const tokenInfo = await this.extractTokenInfo(accountData);
            if (!tokenInfo || tokenInfo.type !== 'buy') return;

            console.log(`⚡ FAST DETECTION: ${tokenInfo.type.toUpperCase()} detected!`);
            console.log(`Token: ${tokenInfo.tokenAddress}`);
            console.log(`Amount: ${tokenInfo.amount}`);

            // Execute trade immediately without extensive safety checks
            await this.executeFastTrade(tokenInfo.tokenAddress, tokenInfo.amount);
        } catch (error) {
            console.error('❌ Error handling token transaction:', error);
        }
    }

    private async extractTokenInfo(data: any): Promise<{ 
        tokenAddress: string; 
        amount: number; 
        type: 'buy' | 'sell';
    } | null> {
        try {
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                new PublicKey(process.env.TARGET_WALLET_ADDRESS!),
                { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
            );

            if (!tokenAccounts.value.length) return null;

            const tokenAccount = tokenAccounts.value[0];
            const tokenData = tokenAccount.account.data.parsed.info;
            const tokenAddress = tokenData.mint;
            const currentBalance = tokenData.tokenAmount.uiAmount;
            
            // Simple balance change detection
            if (currentBalance > 0) {
                return {
                    tokenAddress,
                    amount: currentBalance,
                    type: 'buy'
                };
            }
            
            return null;
        } catch (error) {
            console.error('❌ Error extracting token info:', error);
            return null;
        }
    }

    private async executeFastTrade(tokenAddress: string, targetAmount: number) {
        try {
            // Check cooldown
            if (Date.now() - this.lastTradeTime < 500) { // 500ms cooldown
                console.log('⏳ Cooldown active, skipping trade');
                return;
            }

            // Calculate our trade amount (0.5% of target amount)
            const ourAmount = Math.min(
                targetAmount * 0.005,
                TRANSACTION_CONFIG.maxSolPerTrade,
                0.05 // Max 0.05 SOL per trade for safety
            );

            if (ourAmount < 0.001) {
                console.log('💰 Trade amount too small, skipping');
                return;
            }

            console.log(`🚀 Executing fast trade: ${ourAmount} SOL for ${tokenAddress}`);

            // Get quote with minimal parameters
            const quoteUrl = `${DEX_CONFIG.jupiterApiUrl}/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${Math.floor(ourAmount * 1e9)}&onlyDirectRoutes=true&asLegacyTransaction=true`;
            
            const quoteResponse = await fetch(quoteUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (!quoteResponse.ok) {
                throw new Error(`Quote failed: ${quoteResponse.statusText}`);
            }
            
            const quote = await quoteResponse.json();
            
            if (!quote.outAmount || !quote.inAmount) {
                throw new Error('Invalid quote received');
            }

            // Get swap transaction with high priority
            const swapResponse = await fetch(`${DEX_CONFIG.jupiterApiUrl}/swap/v1/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userPublicKey: walletManager.getPublicKey().toString(),
                    quoteResponse: quote,
                    prioritizationFeeLamports: {
                        priorityLevelWithMaxLamports: {
                            maxLamports: 10000000, // 10M lamports for maximum priority
                            priorityLevel: "veryHigh"
                        }
                    },
                    asLegacyTransaction: true,
                    skipUserAccountsCheck: true,
                    computeUnitPriceMicroLamports: 20000 // Very high compute unit price
                })
            });
            
            if (!swapResponse.ok) {
                throw new Error(`Swap failed: ${swapResponse.statusText}`);
            }
            
            const swapTransaction = await swapResponse.json();
            
            if (!swapTransaction.swapTransaction) {
                throw new Error('Invalid swap transaction received');
            }

            // Execute transaction immediately
            const transaction = VersionedTransaction.deserialize(
                Buffer.from(swapTransaction.swapTransaction, 'base64')
            );
            
            const signature = await walletManager.signAndSendTransaction(transaction, {
                skipPreflight: true,
                maxRetries: 1,
                preflightCommitment: 'processed'
            });

            this.lastTradeTime = Date.now();
            console.log(`✅ Fast trade executed! Signature: ${signature}`);
            logger.logTransactionSuccess(signature, tokenAddress, ourAmount.toString());
            
        } catch (error: any) {
            console.error('❌ Fast trade failed:', error.message);
            logger.logTransactionFailure('pending', tokenAddress, '0', error.message);
        }
    }

    start() {
        this.isRunning = true;
        console.log('🚀 Fast Sniper started! Monitoring target wallet...');
    }

    stop() {
        this.isRunning = false;
        this.ws.close();
        console.log('🛑 Fast Sniper stopped');
    }
}

// Start the fast sniper
const fastSniper = new FastSniper();
fastSniper.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Fast Sniper...');
    fastSniper.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down Fast Sniper...');
    fastSniper.stop();
    process.exit(0);
}); 