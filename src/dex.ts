import fetch from 'node-fetch';
import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config';
import { walletManager } from './wallet';
import { logger } from './utils/logger';

interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
}

class DexManager {
    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const response = await fetch(`${DEX_CONFIG.jupiterApiUrl}/price?token=${tokenAddress}`);
            if (!response.ok) {
                throw new Error(`Failed to get price: ${response.statusText}`);
            }
            const data = await response.json();
            return data.price || 0;
        } catch (error: any) {
            logger.logError('dex', 'Failed to get token price', error.message);
            throw error;
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

            // Get quote from Jupiter
            const quoteResponse = await fetch(`${DEX_CONFIG.jupiterApiUrl}/quote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputMint: 'So11111111111111111111111111111111111111112', // SOL
                    outputMint: tokenAddress,
                    amount: amount * 1e9, // Convert to lamports
                    slippageBps: TRANSACTION_CONFIG.maxSlippage * 100,
                    onlyDirectRoutes: false,
                    asLegacyTransaction: true
                })
            });
            
            if (!quoteResponse.ok) {
                throw new Error(`Failed to get quote: ${quoteResponse.statusText}`);
            }
            
            const quote = await quoteResponse.json();
            logger.logInfo('dex', 'Quote received', JSON.stringify(quote, null, 2));
            
            // Get swap transaction
            const swapResponse = await fetch(`${DEX_CONFIG.jupiterApiUrl}/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse: quote,
                    userPublicKey: walletManager.getPublicKey().toString(),
                    wrapUnwrapSOL: true,
                    computeUnitPriceMicroLamports: TRANSACTION_CONFIG.priorityFee
                })
            });
            
            if (!swapResponse.ok) {
                throw new Error(`Failed to get swap transaction: ${swapResponse.statusText}`);
            }
            
            const swapTransaction = await swapResponse.json();
            logger.logInfo('dex', 'Swap transaction prepared', 'Executing transaction');
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(
                swapTransaction.swapTransaction
            );
            
            logger.logTransactionSuccess(signature, tokenAddress, amount.toString());
            return signature;
        } catch (error: any) {
            logger.logTransactionFailure('pending', tokenAddress, amount.toString(), error.message);
            throw error;
        }
    }
    private async getTokenLiquidity(tokenAddress: string): Promise<number> {
        try {
            const response = await fetch(`${DEX_CONFIG.jupiterApiUrl}/liquidity?token=${tokenAddress}`);
            if (!response.ok) {
                throw new Error(`Failed to get liquidity: ${response.statusText}`);
            }
            const data = await response.json();
            return data.liquidity || 0;
        } catch (error: any) {
            logger.logError('dex', 'Error fetching token liquidity', error.message);
            return 0;
        }
    }

    public async calculatePriceImpact(
        tokenAddress: string,
        amount: number
    ): Promise<number> {
        // Implement price impact calculation
        return 0;
    }
}

export const dexManager = new DexManager();
            