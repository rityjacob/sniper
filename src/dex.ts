import fetch, { Response } from 'node-fetch';
import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config';
import { walletManager } from './wallet';
import { logger } from './utils/logger';
import { Connection, PublicKey, Transaction, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
}

class DexManager {
    private lastApiCall: number = 0;
    private readonly minApiCallInterval = 100; // 100ms between API calls

    private async rateLimitedFetch(url: string, options?: any): Promise<Response> {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCall;
        
        if (timeSinceLastCall < this.minApiCallInterval) {
            await new Promise(resolve => setTimeout(resolve, this.minApiCallInterval - timeSinceLastCall));
        }
        
        this.lastApiCall = Date.now();
        const response = await fetch(url, options);
        
        if (!response.ok) {
            const errorJson = await response.json();
            logger.logError('dex', `API call failed: ${response.statusText}`, 
                `URL: ${url}\nStatus: ${response.status}\nResponse: ${JSON.stringify(errorJson)}`
            );
            throw new Error(`API call failed: ${response.statusText} - ${JSON.stringify(errorJson)}`);
        }
        
        return response;
    }

    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const response = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/price`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ids: [tokenAddress]
                    })
                }
            );
            const data = await response.json();
            const price = data.data?.[tokenAddress]?.price || 0;
            
            logger.logInfo('dex', 'Token price fetched', 
                `Token: ${tokenAddress}, Price: ${price} SOL`
            );
            
            return price;
        } catch (error: any) {
            console.error('Debug - Token Price Error:', {
                error: error.message,
                url: `${DEX_CONFIG.jupiterApiUrl}/price`,
                status: error.status,
                response: error.response,
                requestBody: { ids: [tokenAddress] }
            });
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
            const hasLiquidity = liquidity > DEX_CONFIG.minLiquidity;
            
            if (!hasLiquidity) {
                logger.logWarning('dex', 'Insufficient liquidity', 
                    `Token: ${tokenAddress}, Liquidity: ${liquidity}, Min Required: ${DEX_CONFIG.minLiquidity}`
                );
            }
            
            return hasLiquidity;
        } catch (error: any) {
            logger.logError('dex', 'Error checking liquidity', error.message);
            return false;
        }
    }
    
    async executeSwap(tokenAddress: string, amount: number): Promise<string> {
        let quoteBody: any;
        let swapBody: any;
        
        try {
            logger.logInfo('dex', 'Executing swap', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL`
            );

            // Check wallet balance first
            const balance = await walletManager.getBalance();
            const requiredBalance = amount + TRANSACTION_CONFIG.minSolBalance;
            
            if (balance < requiredBalance) {
                const error = `Insufficient balance. Have: ${balance} SOL, Need: ${requiredBalance} SOL`;
                logger.logError('dex', 'Insufficient balance for swap', error);
                throw new Error(error);
            }

            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            const wallet = walletManager.getCurrentWallet();

            // Get quote from Jupiter
            const quoteUrl = `${DEX_CONFIG.jupiterApiUrl}/quote`;
            quoteBody = {
                inputMint: 'So11111111111111111111111111111111111111112', // SOL
                outputMint: tokenAddress,
                amount: Math.floor(amount * 1e9).toString(), // Convert to lamports and ensure it's a string
                slippageBps: Math.floor(TRANSACTION_CONFIG.maxSlippage * 10000), // Convert to basis points
                onlyDirectRoutes: false,
                asLegacyTransaction: true,
                platformFeeBps: 0
            };

            console.log('Debug - Quote Request:', {
                url: quoteUrl,
                body: quoteBody
            });

            const quoteResponse = await this.rateLimitedFetch(
                quoteUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(quoteBody)
                }
            );
            
            const quote = await quoteResponse.json();
            
            if (!quote.outAmount || !quote.inAmount) {
                console.error('Debug - Invalid Quote Response:', quote);
                throw new Error('Invalid quote received from Jupiter');
            }

            // Get swap transaction
            const swapUrl = `${DEX_CONFIG.jupiterApiUrl}/swap`;
            swapBody = {
                quoteResponse: quote,
                userPublicKey: walletManager.getPublicKey().toString(),
                wrapUnwrapSOL: true,
                computeUnitPriceMicroLamports: TRANSACTION_CONFIG.priorityFee,
                asLegacyTransaction: true
            };

            console.log('Debug - Swap Request:', {
                url: swapUrl,
                body: swapBody
            });

            const swapResponse = await this.rateLimitedFetch(
                swapUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(swapBody)
                }
            );
            
            const swapTransaction = await swapResponse.json();
            
            if (!swapTransaction.swapTransaction) {
                console.error('Debug - Invalid Swap Response:', swapTransaction);
                throw new Error('Invalid swap transaction received from Jupiter');
            }

            logger.logInfo('dex', 'Swap transaction prepared', 'Executing transaction');
            
            // Deserialize the versioned transaction
            const transaction = VersionedTransaction.deserialize(
                Buffer.from(swapTransaction.swapTransaction, 'base64')
            );
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(transaction);
            
            logger.logTransactionSuccess(signature, tokenAddress, amount.toString());
            return signature;
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
            logger.logTransactionFailure('pending', tokenAddress, amount.toString(), errorMessage);
            
            // Check if it's a simulation error and extract more details
            if (error.logs) {
                logger.logError('dex', 'Transaction simulation failed', 
                    `Logs: ${JSON.stringify(error.logs, null, 2)}`
                );
            }
            
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

            // Get quote from Jupiter
            const quoteResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
            );
            
            const quote = await quoteResponse.json();
            logger.logInfo('dex', 'Sell quote received', JSON.stringify(quote, null, 2));
            
            // Validate quote
            if (!quote.outAmount || !quote.inAmount) {
                throw new Error('Invalid quote received from Jupiter');
            }

            // Get swap transaction
            const swapResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/swap`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        quoteResponse: quote,
                        userPublicKey: walletManager.getPublicKey().toString(),
                        wrapUnwrapSOL: true,
                        computeUnitPriceMicroLamports: TRANSACTION_CONFIG.priorityFee
                    })
                }
            );
            
            const swapTransaction = await swapResponse.json();
            
            if (!swapTransaction.swapTransaction) {
                throw new Error('Invalid swap transaction received from Jupiter');
            }

            logger.logInfo('dex', 'Sell transaction prepared', 'Executing transaction');
            
            // Deserialize the transaction
            const transaction = Transaction.from(Buffer.from(swapTransaction.swapTransaction, 'base64'));
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(transaction);
            
            logger.logTransactionSuccess(signature, tokenAddress, tokenAmount.toString());
            return signature;
        } catch (error: any) {
            logger.logTransactionFailure('pending', tokenAddress, tokenAmount.toString(), error.message);
            throw error;
        }
    }

    async getTokenBalance(tokenAddress: string): Promise<number> {
        try {
            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            const wallet = walletManager.getCurrentWallet();
            const tokenPublicKey = new PublicKey(tokenAddress);
            const walletPublicKey = walletManager.getPublicKey();
            
            // Get the associated token account
            const associatedTokenAccount = await PublicKey.findProgramAddress(
                [
                    walletPublicKey.toBuffer(),
                    TOKEN_PROGRAM_ID.toBuffer(),
                    tokenPublicKey.toBuffer(),
                ],
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            // Get token balance
            const balance = await connection.getTokenAccountBalance(associatedTokenAccount[0]);
            
            logger.logInfo('dex', 'Token balance fetched', 
                `Token: ${tokenAddress}, Balance: ${balance.value.uiAmount}`
            );
            
            return balance.value.uiAmount || 0;
        } catch (error: any) {
            logger.logError('dex', 'Error fetching token balance', error.message);
            return 0;
        }
    }

    async calculateExpectedReturn(tokenAddress: string, tokenAmount: number): Promise<{
        expectedSol: number;
        priceImpact: number;
        minimumReceived: number;
    }> {
        try {
            const quoteResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
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
            const amountToSell = Math.floor(balance * (percentage / 100));

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
            