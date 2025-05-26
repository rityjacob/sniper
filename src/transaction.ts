import { 
    TRANSACTION_CONFIG,
    SAFETY_CONFIG,
    MONITORING_CONFIG,
    DEX_CONFIG
} from './config';
import { dexManager } from './dex';
import { logger } from './utils/logger';
import { walletManager } from './wallet';
import { PublicKey } from '@solana/web3.js';

interface Transaction {
    signature: string;
    timestamp: number;
    tokenAddress: string;
    amount: string;
    targetAmount?: number;
    type: 'buy' | 'sell';
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

        // Additional mainnet safety checks
        if (!tx.tokenAddress || !tx.amount) {
            logger.logWarning('safety', 'Invalid transaction data', 'Missing required fields');
            return false;
        }

        // Validate token address format
        try {
            new PublicKey(tx.tokenAddress);
        } catch (error) {
            logger.logWarning('safety', 'Invalid token address format', tx.tokenAddress);
            return false;
        }

        // Validate amount is a positive number
        const amount = Number(tx.amount);
        if (isNaN(amount) || amount <= 0) {
            logger.logWarning('safety', 'Invalid amount', `Amount: ${tx.amount}`);
            return false;
        }
        
        this.updateTradeCounters();

        // Calculate amounts based on transaction type
        const targetAmount = Number(tx.amount);
        let finalAmount: number;

        if (tx.type === 'buy') {
            // For buys, we take a percentage of their buy amount
            const percentageAmount = targetAmount * TRANSACTION_CONFIG.percentageOfTargetTrade;
            finalAmount = Math.min(
                percentageAmount,
                TRANSACTION_CONFIG.maxBuyAmount,
                TRANSACTION_CONFIG.maxSolPerTrade
            );

            // Additional check for minimum trade amount
            if (finalAmount < 0.01) {
                logger.logWarning('safety', 'Trade amount too small', `Amount: ${finalAmount} SOL`);
                return false;
            }
        } else {
            // For sells, we follow their exact proportion
            const ourBalance = await dexManager.getTokenBalance(tx.tokenAddress);
            if (ourBalance <= 0) {
                logger.logWarning('safety', 'No tokens to sell', `Token: ${tx.tokenAddress}`);
                return false;
            }

            const proportion = targetAmount / tx.targetAmount!;
            finalAmount = ourBalance * proportion;
            
            // Still apply safety limits
            finalAmount = Math.min(
                finalAmount,
                TRANSACTION_CONFIG.maxSolPerTrade
            );
        }

        logger.logInfo('system', 'Calculating trade amounts', 
            `Type: ${tx.type}, Target: ${targetAmount} SOL, Final: ${finalAmount} SOL`
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

            // Check wallet balance before proceeding
            const walletBalance = await walletManager.getBalance();
            if (walletBalance < TRANSACTION_CONFIG.minSolBalance) {
                logger.logWarning('safety', 'Insufficient wallet balance', 
                    `Balance: ${walletBalance} SOL, Min Required: ${TRANSACTION_CONFIG.minSolBalance} SOL`
                );
                return false;
            }
    
            logger.logInfo('system', 'Transaction validation successful', 
                `Type: ${tx.type}, Token: ${tx.tokenAddress}, Amount: ${tx.amount} SOL`
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