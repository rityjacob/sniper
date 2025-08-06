import fetch, { Response } from 'node-fetch';
import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config';
import { walletManager } from './wallet';
import { logger } from './utils/logger';
import { Connection, PublicKey, Transaction, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount, getMint } from '@solana/spl-token';

// Add AbortController type
declare global {
    interface AbortController {
        signal: AbortSignal;
        abort(): void;
    }
    interface AbortSignal {
        aborted: boolean;
    }
}

interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
}

class DexManager {
    private lastApiCall: number = 0;
    private readonly minApiCallInterval = 100; // 100ms between API calls
    private readonly maxRetries = 3;
    private readonly initialRetryDelay = 1000; // 1 second
    private readonly timeout = 30000; // 30 seconds
    private readonly jupiterEndpoints = [
        'https://quote-api.jup.ag/v6',
        'https://quote-api.jup.ag/v6',
        'https://quote-api.jup.ag/v6'
    ];
    private currentEndpointIndex = 0;
    private consecutiveFailures = 0;
    private readonly maxConsecutiveFailures = 5;
    private readonly circuitBreakerResetTime = 60000; // 1 minute
    private lastFailureTime = 0;

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getNextEndpoint(): string {
        this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.jupiterEndpoints.length;
        return this.jupiterEndpoints[this.currentEndpointIndex];
    }

    private async validateToken(tokenAddress: string): Promise<boolean> {
        try {
            const connection = walletManager.getConnection();
            const mintInfo = await getMint(connection, new PublicKey(tokenAddress));
            return mintInfo !== null;
        } catch (error) {
            logger.logError('dex', 'Invalid token address', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    private async rateLimitedFetch(url: string, options?: any, retryCount = 0): Promise<Response> {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCall;
        
        if (timeSinceLastCall < this.minApiCallInterval) {
            await this.sleep(this.minApiCallInterval - timeSinceLastCall);
        }

        // Check circuit breaker
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            const timeSinceLastFailure = now - this.lastFailureTime;
            if (timeSinceLastFailure < this.circuitBreakerResetTime) {
                throw new Error('Circuit breaker open - too many consecutive failures');
            }
            this.consecutiveFailures = 0;
        }
        
        this.lastApiCall = Date.now();

        try {
            const baseUrl = this.getNextEndpoint();
            const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;

            // Validate token address if it's a quote request
            if (fullUrl.includes('/quote')) {
                const urlParams = new URL(fullUrl).searchParams;
                const inputMint = urlParams.get('inputMint');
                const outputMint = urlParams.get('outputMint');
                
                if (inputMint && !inputMint.includes('So11111111111111111111111111111111111111112')) {
                    const isValid = await this.validateToken(inputMint);
                    if (!isValid) {
                        throw new Error('Invalid input token address');
                    }
                }
                if (outputMint && !outputMint.includes('So11111111111111111111111111111111111111112')) {
                    const isValid = await this.validateToken(outputMint);
                    if (!isValid) {
                        throw new Error('Invalid output token address');
                    }
                }
            }

            const response = await fetch(fullUrl, {
                ...options,
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SniperBot/1.0',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    ...options?.headers
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.logError('dex', `API call failed: ${response.statusText}`, 
                    `URL: ${fullUrl}\nStatus: ${response.status}\nResponse: ${errorText}`
                );
                throw new Error(`API call failed: ${response.statusText} - ${errorText}`);
            }
            
            this.consecutiveFailures = 0;
            return response;
        } catch (error: any) {
            this.consecutiveFailures++;
            this.lastFailureTime = Date.now();

            const isNetworkError = error.code === 'ECONNRESET' || 
                                 error.code === 'ETIMEDOUT' ||
                                 error.message.includes('network') ||
                                 error.message.includes('timeout');

            if (isNetworkError && retryCount < this.maxRetries) {
                const delay = this.initialRetryDelay * Math.pow(2, retryCount);
                logger.logWarning('dex', `Retrying API call (${retryCount + 1}/${this.maxRetries})`, 
                    `URL: ${url}\nDelay: ${delay}ms\nError: ${error.message}`
                );
                await this.sleep(delay);
                return this.rateLimitedFetch(url, options, retryCount + 1);
            }

            logger.logError('dex', 'API call failed after retries', 
                `URL: ${url}\nError: ${error.message}`
            );
            throw error;
        }
    }

    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const response = await this.rateLimitedFetch(
                `https://lite-api.jup.ag/price/v2?ids=${tokenAddress}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            const data = await response.json();
            const price = data.data?.[tokenAddress]?.price || 0;
            
            logger.logInfo('dex', 'Token price fetched', 
                `Token: ${tokenAddress}, Price: ${price} SOL`
            );
            
            return price;
        } catch (error: any) {
            console.error('🔴 Debug - Token Price Error:');
            console.dir(error, { depth: null });
            logger.logError('dex', 'Failed to get token price', error.message);
            throw error;
        }
    }

    private async getTokenLiquidity(tokenAddress: string): Promise<number> {
        try {
            const response = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/liquidity?token=${tokenAddress}`
            );
            const data = await response.json();
            const liquidity = data.liquidity || 0;
            
            logger.logInfo('dex', 'Token liquidity fetched', 
                `Token: ${tokenAddress}, Liquidity: ${liquidity} SOL`
            );
            
            return liquidity;
        } catch (error: any) {
            logger.logError('dex', 'Error fetching token liquidity', error.message);
            return 0;
        }
    }

    async checkLiquidity(tokenAddress: string): Promise<boolean> {
        try {
            const liquidity = await this.getTokenLiquidity(tokenAddress);
            // Log liquidity for debugging but don't restrict based on it
            logger.logInfo('dex', 'Token liquidity', 
                `Token: ${tokenAddress}, Liquidity: ${liquidity} SOL`
            );
            return true; // Always return true regardless of liquidity
        } catch (error: any) {
            logger.logError('dex', 'Error checking liquidity', error.message);
            return true; // Return true even on error to not block trades
        }
    }
    
    async executeSwap(tokenAddress: string, amount: number, originalPrice?: number): Promise<string> {
        let quoteBody: any;
        let swapBody: any;
        
        try {
            console.log('\n🚀 === EXECUTING SWAP ===');
            console.log('🎯 Token Address:', tokenAddress);
            console.log('💰 Amount:', amount, 'SOL');
            console.log('⚙️  Compute Unit Price:', TRANSACTION_CONFIG.computeUnitPrice);
            console.log('⚙️  Compute Unit Limit:', TRANSACTION_CONFIG.computeUnitLimit);
            
            logger.logInfo('dex', 'Executing swap', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL`
            );

            // Check wallet balance first
            const balance = await walletManager.getBalance();
            const requiredBalance = amount + TRANSACTION_CONFIG.minSolBalance;
            
            console.log('💳 BALANCE CHECK:');
            console.log('   - Current Balance:', balance.toFixed(6), 'SOL');
            console.log('   - Required Balance:', requiredBalance.toFixed(6), 'SOL');
            console.log('   - Min SOL Balance:', TRANSACTION_CONFIG.minSolBalance, 'SOL');
            
            if (balance < requiredBalance) {
                const error = `Insufficient balance. Have: ${balance} SOL, Need: ${requiredBalance} SOL`;
                console.log('❌ INSUFFICIENT BALANCE:', error);
                logger.logError('dex', 'Insufficient balance for swap', error);
                throw new Error(error);
            }
            
            console.log('✅ BALANCE SUFFICIENT');

            // Check price movement if original price is provided
            if (originalPrice) {
                const currentPrice = await this.getTokenPrice(tokenAddress);
                const priceChange = ((currentPrice - originalPrice) / originalPrice) * 100;
                
                logger.logInfo('dex', 'Price movement check', 
                    `Original: ${originalPrice}, Current: ${currentPrice}, Change: ${priceChange.toFixed(2)}%`
                );

                if (priceChange >= 100) {
                    const error = `Price has moved too much (${priceChange.toFixed(2)}%). Skipping trade.`;
                    logger.logWarning('dex', 'Trade skipped due to price movement', error);
                    throw new Error(error);
                }
            }

            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            const wallet = walletManager.getCurrentWallet();

            // Get quote from Jupiter
            console.log('📡 GETTING JUPITER QUOTE...');
            const quoteParams = new URLSearchParams({
                inputMint: 'So11111111111111111111111111111111111111112', // SOL
                outputMint: tokenAddress,
                amount: Math.floor(amount * 1e9).toString(), // Convert SOL to lamports
                slippageBps: Math.floor(TRANSACTION_CONFIG.maxSlippage * 100).toString(),
                onlyDirectRoutes: 'false',
                asLegacyTransaction: 'false' // Use versioned transactions
            });

            console.log('📋 Quote Parameters:');
            console.log('   - Input Mint: SOL');
            console.log('   - Output Mint:', tokenAddress);
            console.log('   - Amount (lamports):', Math.floor(amount * 1e9));
            console.log('   - Slippage BPS:', Math.floor(TRANSACTION_CONFIG.maxSlippage * 100));

            const quoteResponse = await this.rateLimitedFetch(
                `https://quote-api.jup.ag/v6/quote?${quoteParams.toString()}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            const quote = await quoteResponse.json();
            console.log('📊 Quote Response:');
            console.log('   - In Amount:', quote.inAmount);
            console.log('   - Out Amount:', quote.outAmount);
            console.log('   - Price Impact:', quote.priceImpactPct);
            console.log('   - Routes:', quote.routes?.length || 0);
            
            if (!quote.outAmount || !quote.inAmount) {
                console.error('❌ Invalid Quote Response:', quote);
                throw new Error('Invalid quote received from Jupiter');
            }
            
            console.log('✅ QUOTE RECEIVED SUCCESSFULLY');

            // Get swap transaction with optimized settings for speed
            console.log('🔧 CREATING SWAP TRANSACTION...');
            const swapUrl = `${DEX_CONFIG.jupiterApiUrl}/swap/v1/swap`;
            swapBody = {
                userPublicKey: walletManager.getPublicKey().toString(),
                quoteResponse: quote,
                // Add high priority fee to get transaction processed faster
                prioritizationFeeLamports: {
                    priorityLevelWithMaxLamports: {
                        maxLamports: TRANSACTION_CONFIG.priorityFee,
                        priorityLevel: "veryHigh"
                    }
                },
                // Optimize compute unit settings
                dynamicComputeUnitLimit: true,
                // Use legacy transaction for faster processing
                asLegacyTransaction: true,
                // Skip token account creation if possible
                skipUserAccountsCheck: true
            };

            console.log('📋 Swap Request Details:');
            console.log('   - User Public Key:', walletManager.getPublicKey().toString());
            console.log('   - Priority Fee:', TRANSACTION_CONFIG.priorityFee, 'lamports');
            console.log('   - Dynamic Compute Unit Limit:', true);
            console.log('   - Legacy Transaction:', true);
            console.log('   - Skip User Accounts Check:', true);

            const swapResponse = await this.rateLimitedFetch(
                'https://quote-api.jup.ag/v6/swap',
                {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(swapBody)
                }
            );
            
            const swapTransaction = await swapResponse.json();
            console.log('📊 Swap Transaction Response:');
            console.log('   - Has Swap Transaction:', !!swapTransaction.swapTransaction);
            console.log('   - Transaction Size:', swapTransaction.swapTransaction?.length || 0, 'characters');
            
            if (!swapTransaction.swapTransaction) {
                console.error('❌ Invalid Swap Response:', swapTransaction);
                throw new Error('Invalid swap transaction received from Jupiter');
            }

            console.log('✅ SWAP TRANSACTION CREATED SUCCESSFULLY');
            logger.logInfo('dex', 'Swap transaction prepared', 'Executing transaction');
            
            // Decode and execute the swap using VersionedTransaction
            console.log('🔐 DESERIALIZING TRANSACTION...');
            const transactionBuffer = Buffer.from(swapTransaction.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            console.log('✅ TRANSACTION DESERIALIZED');
            
            // Execute the swap
            console.log('📤 SENDING TRANSACTION...');
            const signature = await walletManager.signAndSendTransaction(transaction);
            
            // Execute the swap with retry logic
            let retries = 0;
            while (retries < TRANSACTION_CONFIG.maxRetries) {
                try {
                    // Send transaction with high priority
                    const signature = await walletManager.signAndSendTransaction(transaction);
                    logger.logTransaction(signature, tokenAddress, amount.toString(), 'success');
                    return signature;
                } catch (error: any) {
                    if (error.message.includes('0x1771') && retries < TRANSACTION_CONFIG.maxRetries - 1) {
                        retries++;
                        await new Promise(resolve => setTimeout(resolve, 50)); // Reduced delay for faster retry
                        continue;
                    }
                    throw error;
                }
            }
            
            throw new Error('Max retries exceeded for swap execution');
        } catch (error: any) {
            console.error('Debug - Swap Error:', {
                error: error.message,
                tokenAddress,
                amount,
                status: error.status,
                response: error.response,
                logs: error.logs,
                requestBody: {
                    quote: quoteBody,
                    swap: swapBody
                }
            });
            const errorMessage = error.message || 'Unknown error';
            logger.logTransaction('pending', tokenAddress, amount.toString(), 'failed', errorMessage);
            throw error;
        }
    }

    public async calculatePriceImpact(
        tokenAddress: string,
        amount: number
    ): Promise<number> {
        try {
            // For devnet testing, simulate a price impact
            // This is a simplified model - in production, you'd use real DEX data
            const simulatedLiquidity = 1000; // Simulated liquidity in SOL
            const priceImpact = (amount / simulatedLiquidity) * 100;
            
            logger.logInfo('dex', 'Price impact calculated', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL, Impact: ${priceImpact.toFixed(2)}%`
            );
            
            return priceImpact;
        } catch (error: any) {
            logger.logError('dex', 'Error calculating price impact', error.message);
            throw error;
        }
    }

    async sellToken(tokenAddress: string, tokenAmount: number): Promise<string> {
        try {
            // Check balance before selling
            const balance = await this.getTokenBalance(tokenAddress);
            if (balance < tokenAmount) {
                throw new Error(`Insufficient balance. Have: ${balance}, Trying to sell: ${tokenAmount}`);
            }

            logger.logInfo('dex', 'Executing sell', 
                `Token: ${tokenAddress}, Amount: ${tokenAmount} tokens`
            );

            const mintInfo = await getMint(walletManager.getConnection(), new PublicKey(tokenAddress));
            const amountRaw = Math.floor(tokenAmount * Math.pow(10, mintInfo.decimals)).toString();

            // Get quote from Jupiter (use GET, not POST)
            const quoteParams = new URLSearchParams({
                inputMint: tokenAddress,
                outputMint: 'So11111111111111111111111111111111111111112', // SOL
                amount: amountRaw,
                slippageBps: Math.floor(TRANSACTION_CONFIG.maxSlippage * 100).toString(),
                onlyDirectRoutes: 'false',
                asLegacyTransaction: 'false'
            });
            const quoteResponse = await this.rateLimitedFetch(
                `https://quote-api.jup.ag/v6/quote?${quoteParams.toString()}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            const quote = await quoteResponse.json();
            logger.logInfo('dex', 'Sell quote received', JSON.stringify(quote, null, 2));
            
            // Validate quote
            if (!quote.outAmount || !quote.inAmount) {
                throw new Error('Invalid quote received from Jupiter');
            }

            // Get swap transaction
            const swapResponse = await this.rateLimitedFetch(
                'https://quote-api.jup.ag/v6/swap',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        quoteResponse: quote,
                        userPublicKey: walletManager.getPublicKey().toString(),
                        wrapUnwrapSOL: true,
                        computeUnitPriceMicroLamports: TRANSACTION_CONFIG.computeUnitPrice,
                        computeUnitLimit: TRANSACTION_CONFIG.computeUnitLimit,
                        asLegacyTransaction: true
                    })
                }
            );
            
            const swapTransaction = await swapResponse.json();
            
            if (!swapTransaction.swapTransaction) {
                throw new Error('Invalid swap transaction received from Jupiter');
            }

            logger.logInfo('dex', 'Sell transaction prepared', 'Executing transaction');
            
            // Decode and execute the swap using VersionedTransaction
            const transactionBuffer = Buffer.from(swapTransaction.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(transaction);
            
            logger.logTransaction(signature, tokenAddress, tokenAmount.toString(), 'success');
            return signature;
        } catch (error: any) {
            logger.logTransaction('pending', tokenAddress, tokenAmount.toString(), 'failed', error.message);
            throw error;
        }
    }

    async getTokenBalance(tokenAddress: string): Promise<number> {
        try {
            const owner = walletManager.getPublicKey();
            const mint = new PublicKey(tokenAddress);
            const ata = await getAssociatedTokenAddress(mint, owner);
            const connection = walletManager.getConnection();
            const accountInfo = await getAccount(connection, ata);
            const mintInfo = await getMint(connection, mint);
            return Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
        } catch (error) {
            logger.logError('dex', 'Error fetching token balance', error instanceof Error ? error.message : String(error));
            return 0;
        }
    }

    async calculateExpectedReturn(tokenAddress: string, tokenAmount: number): Promise<{
        expectedSol: number;
        priceImpact: number;
        minimumReceived: number;
    }> {
        try {
            const mintInfo = await getMint(walletManager.getConnection(), new PublicKey(tokenAddress));
            const amountRaw = Math.floor(tokenAmount * Math.pow(10, mintInfo.decimals)).toString();
            const quoteParams = new URLSearchParams({
                inputMint: tokenAddress,
                outputMint: 'So11111111111111111111111111111111111111112',
                amount: amountRaw,
                slippageBps: Math.floor(TRANSACTION_CONFIG.maxSlippage * 100).toString(),
                onlyDirectRoutes: 'false',
                asLegacyTransaction: 'false'
            });
            const quoteResponse = await this.rateLimitedFetch(
                `https://quote-api.jup.ag/v6/quote?${quoteParams.toString()}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            const quote = await quoteResponse.json();
            const priceImpact = await this.calculatePriceImpact(tokenAddress, tokenAmount);
            const minimumReceived = quote.outAmount * (1 - TRANSACTION_CONFIG.maxSlippage);
            
            return {
                expectedSol: quote.outAmount / 1e9, // Convert lamports to SOL
                priceImpact,
                minimumReceived: minimumReceived / 1e9
            };
        } catch (error: any) {
            logger.logError('dex', 'Error calculating expected return', error.message);
            throw error;
        }
    }

    async sellPercentageOfHoldings(tokenAddress: string, percentage: number): Promise<string> {
        try {
            if (percentage <= 0 || percentage > 100) {
                throw new Error('Percentage must be between 0 and 100');
            }

            const balance = await this.getTokenBalance(tokenAddress);
            const amountToSell = balance * (percentage / 100);

            if (amountToSell <= 0) {
                throw new Error('No tokens available to sell');
            }

            const expectedReturn = await this.calculateExpectedReturn(tokenAddress, amountToSell);
            logger.logInfo('dex', 'Selling percentage of holdings', 
                `Token: ${tokenAddress}, Percentage: ${percentage}%, Amount: ${amountToSell}, Expected SOL: ${expectedReturn.expectedSol}`
            );

            return await this.sellToken(tokenAddress, amountToSell);
        } catch (error: any) {
            logger.logError('dex', 'Error selling percentage of holdings', error.message);
            throw error;
        }
    }
}

export const dexManager = new DexManager();