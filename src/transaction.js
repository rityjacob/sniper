import { SAFETY_CONFIG, DEX_CONFIG } from './config.js';
import { dexManager } from './dex.js';
class TransactionManager {
    constructor() {
        this.lastTradeTime = 0;
        this.tradesThisHour = 0;
        this.tradesThisDay = 0;
        this.lastTradeReset = Date.now();
    }
    async processTransaction(tx) {
        if (!this.checkSafetyLimits()) {
            console.log("Safety limits exceeded. Skipping transaction.");
            return false;
        }
        if (Date.now() - this.lastTradeTime < SAFETY_CONFIG.tradeCooldown) {
            console.log("Trade cooldown active. Skipping transaction.");
            return false;
        }
        this.updateTradeCounters();
        try {
            // Check if token is blacklisted
            if (SAFETY_CONFIG.blacklistedTokens.includes(tx.tokenAddress)) {
                console.log("🚫 Token is blacklisted");
                return false;
            }
            // Check token liquidity
            const hasLiquidity = await dexManager.checkLiquidity(tx.tokenAddress);
            if (!hasLiquidity) {
                console.log("⚠️ Insufficient liquidity");
                return false;
            }
            // Check price impact
            const priceImpact = await dexManager.calculatePriceImpact(tx.tokenAddress, Number(tx.amount));
            if (priceImpact > DEX_CONFIG.maxPriceImpact) {
                console.log("⚠️ Price impact too high");
                return false;
            }
            return true;
        }
        catch (error) {
            console.error("❌ Transaction validation failed:", error);
            return false;
        }
    }
    checkSafetyLimits() {
        const now = Date.now();
        // Reset hourly counter if needed
        if (now - this.lastTradeReset >= 3600000) {
            this.tradesThisHour = 0;
            this.lastTradeReset = now;
        }
        // Check hourly limit
        if (this.tradesThisHour >= SAFETY_CONFIG.maxTradesPerHour) {
            return false;
        }
        // Check daily limit
        if (this.tradesThisDay >= SAFETY_CONFIG.maxDailyTradeValue) {
            return false;
        }
        return true;
    }
    updateTradeCounters() {
        this.tradesThisHour++;
        this.tradesThisDay++;
    }
}
export const transactionManager = new TransactionManager();
