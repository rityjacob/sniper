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
    private readonly transactionLogPath: string;
    private readonly eventLogPath: string;
    private readonly logDir: string;

    constructor() {
        // Create logs directory if it doesn't exist
        this.logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir);
        }

        // Set up log file paths
        this.transactionLogPath = path.join(this.logDir, 'transactions.csv');
        this.eventLogPath = path.join(this.logDir, 'events.csv');

        // Initialize CSV files with headers if they don't exist
        this.initializeLogFiles();
    }

    private initializeLogFiles() {
        // Initialize transactions log
        if (!fs.existsSync(this.transactionLogPath)) {
            const transactionHeaders = [
                'timestamp',
                'signature',
                'tokenAddress',
                'amount',
                'status',
                'error',
                'priceImpact',
                'liquidity'
            ].join(',');
            fs.writeFileSync(this.transactionLogPath, transactionHeaders + '\n');
        }

        // Initialize events log
        if (!fs.existsSync(this.eventLogPath)) {
            const eventHeaders = [
                'timestamp',
                'type',
                'category',
                'message',
                'details'
            ].join(',');
            fs.writeFileSync(this.eventLogPath, eventHeaders + '\n');
        }
    }

    private escapeCsvValue(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    logTransaction(log: TransactionLog) {
        const row = [
            log.timestamp,
            log.signature,
            log.tokenAddress,
            log.amount,
            log.status,
            log.error || '',
            log.priceImpact?.toString() || '',
            log.liquidity?.toString() || ''
        ].map(this.escapeCsvValue).join(',');

        fs.appendFileSync(this.transactionLogPath, row + '\n');
        
        // Also log to console for immediate feedback
        console.log(`Transaction ${log.status}: ${log.signature}`);
        if (log.error) {
            console.error(`Error: ${log.error}`);
        }
    }

    logEvent(log: EventLog) {
        const row = [
            log.timestamp,
            log.type,
            log.category,
            log.message,
            log.details || ''
        ].map(this.escapeCsvValue).join(',');

        fs.appendFileSync(this.eventLogPath, row + '\n');
        
        // Also log to console for immediate feedback
        const prefix = {
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        }[log.type];
        console.log(`${prefix} ${log.message}`);
        if (log.details) {
            console.log(`Details: ${log.details}`);
        }
    }

    // Helper methods for common logging scenarios
    logTransactionSuccess(signature: string, tokenAddress: string, amount: string, priceImpact?: number, liquidity?: number) {
        this.logTransaction({
            timestamp: new Date().toISOString(),
            signature,
            tokenAddress,
            amount,
            status: 'success',
            priceImpact,
            liquidity
        });
    }

    logTransactionFailure(signature: string, tokenAddress: string, amount: string, error: string, priceImpact?: number, liquidity?: number) {
        this.logTransaction({
            timestamp: new Date().toISOString(),
            signature,
            tokenAddress,
            amount,
            status: 'failed',
            error,
            priceImpact,
            liquidity
        });
    }

    logError(category: EventLog['category'], message: string, details?: string) {
        this.logEvent({
            timestamp: new Date().toISOString(),
            type: 'error',
            category,
            message,
            details
        });
    }

    logWarning(category: EventLog['category'], message: string, details?: string) {
        this.logEvent({
            timestamp: new Date().toISOString(),
            type: 'warning',
            category,
            message,
            details
        });
    }

    logInfo(category: EventLog['category'], message: string, details?: string) {
        this.logEvent({
            timestamp: new Date().toISOString(),
            type: 'info',
            category,
            message,
            details
        });
    }
}

// Export a singleton instance
export const logger = new Logger(); 