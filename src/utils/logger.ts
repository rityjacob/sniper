import * as fs from 'fs';
import * as path from 'path';

interface TransactionLog {
    timestamp: string;
    signature: string;
    tokenAddress: string;
    amount: string;
    status: 'success' | 'failed';
    error?: string;
    priceImpact?: number;
    liquidity?: number;
}

interface EventLog {
    timestamp: string;
    type: 'error' | 'warning' | 'info';
    category: 'network' | 'dex' | 'wallet' | 'safety' | 'system';
    message: string;
    details?: string;
}

class Logger {
    logInfo(category: string, message: string, details?: string) {
        console.log(`[INFO][${category}] ${message}`);
        if (details) {
            console.log(`Details: ${details}`);
        }
    }

    logWarning(category: string, message: string, details?: string) {
        console.warn(`[WARNING][${category}] ${message}`);
        if (details) {
            console.warn(`Details: ${details}`);
        }
    }

    logError(category: string, message: string, details?: string) {
        console.error(`[ERROR][${category}] ${message}`);
        if (details) {
            console.error(`Details: ${details}`);
        }
    }

    logTransaction(signature: string, tokenAddress: string, amount: string, status: 'success' | 'failed', error?: string) {
        console.log(`[TRANSACTION] ${status.toUpperCase()}: ${signature} - ${tokenAddress} - ${amount} SOL`);
        if (error) {
            console.error(`Error: ${error}`);
        }
    }
}

// Export a singleton instance
export const logger = new Logger(); 