import { 
    TRANSACTION_CONFIG,
    SAFETY_CONFIG,
    MONITORING_CONFIG,
    DEX_CONFIG
} from './config';
import { dexManager } from './dex';
import { logger } from './utils/logger';

interface Transaction {
    signature: string;
    timestamp: number;
    tokenAddress: string;
    amount: string;
    targetAmount?: number;
}

class TransactionManager {
    private lastTradeTime: number = 0;
    private tradesThisHour: number = 0;
    private tradesThisDay: number = 0;
    private lastTradeReset: number = Date.now();

    async processTransaction(tx: Transaction): Promise<boolean> {
        if (!this.checkSafetyLimits()) {
            logger.logWarning('safety', 'Safety limits exceeded', 'Skipping transaction');
            return false;
        }

        if (Date.now() - this.lastTradeTime < SAFETY_CONFIG.tradeCooldown) {
            logger.logWarning('safety', 'Trade cooldown active', 'Skipping transaction');
            return false;
        }
        
        this.updateTradeCounters();

        // Add the buy amount calculation here
        const targetAmount = Number(tx.amount);  // Convert string amount to number
        const percentageAmount = targetAmount * TRANSACTION_CONFIG.percentageOfTargetTrade;
        const finalAmount = Math.min(
            percentageAmount,
            TRANSACTION_CONFIG.maxBuyAmount,
            TRANSACTION_CONFIG.maxSolPerTrade
        );

        logger.logInfo('system', 'Calculating trade amounts', 
            `Target: ${targetAmount} SOL, Percentage: ${percentageAmount} SOL, Final: ${finalAmount} SOL`
        );

        // Store the calculated amount for the swap
        tx.amount = finalAmount.toString();

        try {
            // Check if token is blacklisted
            if (SAFETY_CONFIG.blacklistedTokens.includes(tx.tokenAddress)) {
                logger.logWarning('safety', 'Token is blacklisted', tx.tokenAddress);
                return false;
            }
    
            // Check token liquidity
            const hasLiquidity = await dexManager.checkLiquidity(tx.tokenAddress);
            if (!hasLiquidity) {
                logger.logWarning('dex', 'Insufficient liquidity', tx.tokenAddress);
                return false;
            }
    
            // Check price impact
            const priceImpact = await dexManager.calculatePriceImpact(
                tx.tokenAddress,
                Number(tx.amount) 
            );
            if (priceImpact > DEX_CONFIG.maxPriceImpact) {
                logger.logWarning('dex', 'Price impact too high', 
                    `Impact: ${priceImpact}%, Max: ${DEX_CONFIG.maxPriceImpact}%`
                );
                return false;
            }
    
            logger.logInfo('system', 'Transaction validation successful', 
                `Token: ${tx.tokenAddress}, Amount: ${tx.amount} SOL`
            );
            return true;
        } catch (error: any) {
            logger.logError('system', 'Transaction validation failed', error.message);
            return false;
        }
    }

    private checkSafetyLimits(): boolean {
        const now = Date.now();
        
        // Reset counters if needed
        if (now - this.lastTradeReset >= 3600000) { // 1 hour
            this.tradesThisHour = 0;
            this.lastTradeReset = now;
        }
        
        if (now - this.lastTradeReset >= 86400000) { // 24 hours
            this.tradesThisDay = 0;
        }

        // Check hourly limit
        if (this.tradesThisHour >= SAFETY_CONFIG.maxTradesPerHour) {
            logger.logWarning('safety', 'Hourly trade limit reached', 
                `Trades this hour: ${this.tradesThisHour}, Max: ${SAFETY_CONFIG.maxTradesPerHour}`
            );
            return false;
        }

        // Check daily limit
        if (this.tradesThisDay >= SAFETY_CONFIG.maxDailyTradeValue) {
            logger.logWarning('safety', 'Daily trade limit reached', 
                `Trades today: ${this.tradesThisDay}, Max: ${SAFETY_CONFIG.maxDailyTradeValue}`
            );
            return false;
        }

        return true;
    }

    private updateTradeCounters() {
        this.tradesThisHour++;
        this.tradesThisDay++;
        this.lastTradeTime = Date.now();
    }
}

export const transactionManager = new TransactionManager();