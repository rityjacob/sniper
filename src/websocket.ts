import WebSocket from "ws";
import { 
    WS_URL, 
    TARGET_WALLET_ADDRESS,
    MONITORING_CONFIG 
} from './config';
import { EventEmitter } from 'events';
import { Connection, PublicKey } from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
let pingInterval: NodeJS.Timeout;
let reconnectAttempts = 0;

class WebSocketManager extends EventEmitter {
    private ws: WebSocket;
    private connection: Connection;
    private previousBalances: Map<string, number> = new Map();
    
    constructor() {
        super();
        this.ws = new WebSocket(WS_URL);
        this.connection = new Connection(WS_URL.replace('wss', 'https'));
        this.setupWebSocket();
    }

    private setupWebSocket() {
        this.ws.on("open", () => {
            console.log("✅ WebSocket connection established!");
            reconnectAttempts = 0;
            
            // Subscribe to target wallet's account
            const subscribeMessage = {
                jsonrpc: "2.0",
                id: 1,
                method: "accountSubscribe",
                params: [
                    TARGET_WALLET_ADDRESS,
                    {
                        encoding: "jsonParsed",
                        commitment: "processed" // Changed from "confirmed" to "processed" for faster detection
                    }
                ]
            };
            
            this.ws.send(JSON.stringify(subscribeMessage));

            // Start ping interval
            pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.ping();
                }
            }, MONITORING_CONFIG.wsReconnectInterval);
        });

        this.ws.on("message", async (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                
                // Handle account updates
                if (parsed?.params?.result?.value) {
                    const accountData = parsed.params.result.value;
                    
                    // Check for token program interactions
                    if (accountData.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                        const tokenInfo = await this.extractTokenInfo(accountData);
                        if (tokenInfo) {
                            console.log(`🔍 Detected ${tokenInfo.type.toUpperCase()} transaction:`);
                            console.log(`Token: ${tokenInfo.tokenAddress}`);
                            console.log(`Amount: ${tokenInfo.amount}`);
                            this.emit('transaction', tokenInfo);
                        }
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
            }
        });
    }

    private async extractTokenInfo(data: any): Promise<{ 
        tokenAddress: string; 
        amount: number; 
        type: 'buy' | 'sell';
        targetAmount?: number;
    } | null> {
        try {
            // Get token account info
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                new PublicKey(TARGET_WALLET_ADDRESS),
                { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
            );

            if (!tokenAccounts.value.length) return null;

            // Get the most recent token account change
            const tokenAccount = tokenAccounts.value[0];
            const tokenData = tokenAccount.account.data.parsed.info;
            const tokenAddress = tokenData.mint;
            
            // Get current balance
            const currentBalance = tokenData.tokenAmount.uiAmount;
            
            // Get previous balance from our cache
            const previousBalance = this.previousBalances.get(tokenAddress) || 0;
            
            // Update our cache
            this.previousBalances.set(tokenAddress, currentBalance);
            
            // Calculate the change
            const balanceChange = currentBalance - previousBalance;
            
            // Only process if there's a significant change
            if (Math.abs(balanceChange) < 0.000001) return null;
            
            // Determine if it's a buy or sell
            const isBuy = balanceChange > 0;
            
            // For sells, we need the total balance to calculate proportions
            const targetAmount = isBuy ? undefined : currentBalance;

            return {
                tokenAddress,
                amount: Math.abs(balanceChange),
                type: isBuy ? 'buy' : 'sell',
                targetAmount
            };
        } catch (error) {
            console.error("❌ Error extracting token info:", error);
            return null;
        }
    }
}

export const wsManager = new WebSocketManager();