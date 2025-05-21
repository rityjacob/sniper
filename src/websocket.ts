import WebSocket from "ws";
import { 
    WS_URL, 
    TARGET_WALLET_ADDRESS,
    MONITORING_CONFIG 
} from './config';
import { EventEmitter } from 'events';

const LAMPORTS_PER_SOL = 1_000_000_000;
let pingInterval: NodeJS.Timeout;
let reconnectAttempts = 0;

class WebSocketManager extends EventEmitter {
    private ws: WebSocket;
    
    constructor() {
        super();
        this.ws = new WebSocket(WS_URL);
        this.setupWebSocket();
    }

    private setupWebSocket() {
        this.ws.on("open", () => {
            console.log("✅ WebSocket connection established!");
            reconnectAttempts = 0;
            subscribeToAccount(this.ws, TARGET_WALLET_ADDRESS);

            // Start ping interval
            pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.ping();
                    if (MONITORING_CONFIG.logLevel === 'debug') {
                        console.log("📡 Sent ping");
                    }
                }
            }, MONITORING_CONFIG.wsReconnectInterval);
        });

        this.ws.on("message", (data) => {
            if (MONITORING_CONFIG.enableDetailedLogging) {
                console.log("📥 New message received");
            }

            try {
                const parsed = JSON.parse(data.toString());
                const lamports = parsed?.params?.result?.value?.lamports;

                if (lamports !== undefined) {
                    console.log(`💰 Target wallet balance: ${lamports / LAMPORTS_PER_SOL} SOL`);
                }

                // Check if it's a transaction notification
                if (parsed?.params?.result?.value?.data) {
                    const transactionData = parsed.params.result.value.data;
                    
                    // Check if it's a token transaction
                    if (this.isTokenTransaction(transactionData)) {
                        const tokenInfo = this.extractTokenInfo(transactionData);
                        
                        // Emit transaction event
                        this.emit('transaction', {
                            tokenAddress: tokenInfo.address,
                            amount: tokenInfo.amount,
                            timestamp: Date.now()
                        });
                    }
                }
            } catch (e) {
                console.error("❌ Failed to parse message:", e);
            }
        });

        this.ws.on("error", (error: Error) => {
            console.error(`❗ WebSocket error: ${error.message}`);
        });

        this.ws.on("close", () => {
            console.log("🔌 Connection closed!");
            clearInterval(pingInterval);

            if (reconnectAttempts < MONITORING_CONFIG.maxWsReconnectAttempts) {
                reconnectAttempts++;
                console.log(`Attempting to reconnect (${reconnectAttempts}/${MONITORING_CONFIG.maxWsReconnectAttempts})...`);
                setTimeout(() => new WebSocketManager(), MONITORING_CONFIG.wsReconnectInterval);
            } else {
                console.error("❌ Maximum reconnection attempts reached!");
                // Implement emergency stop if needed
            }
        });
    }

    private isTokenTransaction(data: any): boolean {
        // Only process token program transactions
        if (!(data.program === 'spl-token' || data.program === 'token' || data.program === 'token-2022')) {
            return false;
        }

        // Check if it's a buy or sell transaction
        // Buy transactions typically involve SOL -> Token
        // Sell transactions typically involve Token -> SOL
        const isBuy = data.type === 'buy' || 
                     (data.instructions && data.instructions.some((ix: any) => 
                         ix.program === 'spl-token' && 
                         ix.parsed?.type === 'transferChecked' &&
                         ix.parsed?.info?.mint === data.tokenAddress
                     ));
        
        const isSell = data.type === 'sell' ||
                      (data.instructions && data.instructions.some((ix: any) =>
                          ix.program === 'spl-token' &&
                          ix.parsed?.type === 'transferChecked' &&
                          ix.parsed?.info?.destination === 'So11111111111111111111111111111111111111112'
                      ));

        return isBuy || isSell;
    }

    private extractTokenInfo(data: any): { address: string; amount: number; type: 'buy' | 'sell'; targetAmount?: number } {
        const isBuy = data.type === 'buy' || 
                     (data.instructions && data.instructions.some((ix: any) => 
                         ix.program === 'spl-token' && 
                         ix.parsed?.type === 'transferChecked' &&
                         ix.parsed?.info?.mint === data.tokenAddress
                     ));

        // For sells, we need to get their total balance to calculate proportion
        let targetAmount: number | undefined;
        if (!isBuy) {
            // Get their total token balance from the transaction data
            targetAmount = data.totalBalance || data.balance || 0;
        }

        return {
            address: data.tokenAddress,
            amount: data.amount,
            type: isBuy ? 'buy' : 'sell',
            targetAmount
        };
    }
}

function subscribeToAccount(ws: WebSocket, account: string) {
    const requestdata = {
        jsonrpc: "2.0",
        id: 1903,
        method: "accountSubscribe",
        params: [
            account,
            {
                encoding: "jsonParsed",
                commitment: "confirmed",
            },
        ],
    };
    ws.send(JSON.stringify(requestdata));
}

export function initializeWebSocket() {
    new WebSocketManager();
}