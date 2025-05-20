import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config.js';
import { walletManager } from './wallet.js';

interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
}

class DexManager {
    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const response = await fetch(`${DEX_CONFIG.jupiterApiUrl}/price?token=${tokenAddress}`);
            const data = await response.json();
            return data.price;
        } catch (error) {
            console.error("Error fetching token price:", error);
            throw error;
        }
    }
    async checkLiquidity(tokenAddress: string): Promise<boolean> {
        try{
            const liquidity = await this.getTokenLiquidity(tokenAddress);
            return liquidity > DEX_CONFIG.minLiquidity;
        } catch (error) {
            console.error("Error checking liquidity:", error);
            return false;
        }
    }
    
    async executeSwap(tokenAddress: string, amount: number): Promise<string> {
        try {
            console.log(`Executing swap for ${amount} SOL of token ${tokenAddress}`);

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
            console.log(`📊 Quote received: ${JSON.stringify(quote, null, 2)}`);
            
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
            console.log(`📝 Swap transaction prepared`);
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(
                swapTransaction.swapTransaction
            );
            
            console.log(`✅ Swap executed successfully: ${signature}`);
            return signature;
        } catch (error) {
            console.error("❌ Swap execution failed:", error);
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
        } catch (error) {
            console.error("Error fetching token liquidity:", error);
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
            