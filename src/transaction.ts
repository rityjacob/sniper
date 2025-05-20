import { 
    TRANSACTION_CONFIG,
    SAFETY_CONFIG,
    MONITORING_CONFIG 
} from './config.js';

interface Transaction {
    signature: string;
    timestamp: number;
    tokenAddress: string;
    amount: string;
}

class TransactionManager {
    private lastTradeTime: number = 0;
    private tradesThisHour: number = 0;
    private tradesThisDay: number = 0;
    private lastTradeReset: number = Date.now();

    async processTransaction(tx: Transaction): Promise<boolean> {
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
            // Add tx logic here
            this.lastTradeTime = Date.now();
            return true;
        } catch (error) {
            console.error("Error processing transaction:", error);
            return false;
        }
    }

    private checkSafetyLimits(): boolean {
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
    private updateTradeCounters(): void {
        this.tradesThisHour++;
        this.tradesThisDay++;
    }
}

export const transactionManager = new TransactionManager();