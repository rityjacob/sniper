import fetch, { Response } from 'node-fetch';
import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config';
import { walletManager } from './wallet';
import { logger } from './utils/logger';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
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
            const errorText = await response.text();
            logger.logError('dex', `API call failed: ${response.statusText}`, 
                `URL: ${url}\nStatus: ${response.status}\nResponse: ${errorText}`
            );
            throw new Error(`API call failed: ${response.statusText} - ${errorText}`);
        }
        
        return response;
    }

    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const response = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/v6/price?ids=${tokenAddress}`
            );
            const data = await response.json();
            const price = data.data?.[tokenAddress]?.price || 0;
            
            logger.logInfo('dex', 'Token price fetched', 
                `Token: ${tokenAddress}, Price: ${price} SOL`
            );
            
            return price;
        } catch (error: any) {
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
        try {
            logger.logInfo('dex', 'Executing swap', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL`
            );

            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            const wallet = walletManager.getCurrentWallet();

            // Get quote from Jupiter
            const quoteResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amount * 1e9}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
            );
            
            const quote = await quoteResponse.json();
            
            if (!quote.outAmount || !quote.inAmount) {
                throw new Error('Invalid quote received from Jupiter');
            }

            // Get swap transaction
            const swapResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/v6/swap`,
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

            logger.logInfo('dex', 'Swap transaction prepared', 'Executing transaction');
            
            // Deserialize the transaction
            const transaction = Transaction.from(Buffer.from(swapTransaction.swapTransaction, 'base64'));
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(transaction);
            
            logger.logTransactionSuccess(signature, tokenAddress, amount.toString());
            return signature;
        } catch (error: any) {
            logger.logTransactionFailure('pending', tokenAddress, amount.toString(), error.message);
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
                `${DEX_CONFIG.jupiterApiUrl}/v6/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
            );
            
            const quote = await quoteResponse.json();
            logger.logInfo('dex', 'Sell quote received', JSON.stringify(quote, null, 2));
            
            // Validate quote
            if (!quote.outAmount || !quote.inAmount) {
                throw new Error('Invalid quote received from Jupiter');
            }

            // Get swap transaction
            const swapResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/v6/swap`,
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
                `${DEX_CONFIG.jupiterApiUrl}/v6/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
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
            