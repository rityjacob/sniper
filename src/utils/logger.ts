export class Logger {
    static logInfo(module: string, message: string, details?: string) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${module.toUpperCase()}] ${message}${details ? ` - ${details}` : ''}`);
    }

    static logError(module: string, message: string, error?: string) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${module.toUpperCase()}] ❌ ${message}${error ? ` - ${error}` : ''}`);
    }

    static logWarning(module: string, message: string, details?: string) {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] [${module.toUpperCase()}] ⚠️  ${message}${details ? ` - ${details}` : ''}`);
    }

    static logSuccess(module: string, message: string, details?: string) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${module.toUpperCase()}] ✅ ${message}${details ? ` - ${details}` : ''}`);
    }
}

export const logger = Logger;