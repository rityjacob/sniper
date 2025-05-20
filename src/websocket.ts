import WebSocket from "ws";
import { 
    WS_URL, 
    TARGET_WALLET_ADDRESS,
    MONITORING_CONFIG 
} from './config.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
let pingInterval: NodeJS.Timeout;
let reconnectAttempts = 0;

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

function createWebSocket() {
    const ws = new WebSocket(WS_URL);

    ws.on("open", () => {
        console.log("✅ WebSocket connection established!");
        reconnectAttempts = 0;
        subscribeToAccount(ws, TARGET_WALLET_ADDRESS);

        // Start ping interval
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
                if (MONITORING_CONFIG.logLevel === 'debug') {
                    console.log("📡 Sent ping");
                }
            }
        }, MONITORING_CONFIG.wsReconnectInterval);
    });

    ws.on("message", (data) => {
        if (MONITORING_CONFIG.enableDetailedLogging) {
            console.log("📥 New message received");
        }

        try {
            const parsed = JSON.parse(data.toString());
            const lamports = parsed?.params?.result?.value?.lamports;

            if (lamports !== undefined) {
                console.log(`💰 Target wallet balance: ${lamports / LAMPORTS_PER_SOL} SOL`);
                // Here you'll add logic to detect transactions
            }
        } catch (e) {
            console.error("❌ Failed to parse message:", e);
        }
    });

    ws.on("error", (error: Error) => {
        console.error(`❗ WebSocket error: ${error.message}`);
    });

    ws.on("close", () => {
        console.log("🔌 Connection closed!");
        clearInterval(pingInterval);

        if (reconnectAttempts < MONITORING_CONFIG.maxWsReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Attempting to reconnect (${reconnectAttempts}/${MONITORING_CONFIG.maxWsReconnectAttempts})...`);
            setTimeout(createWebSocket, MONITORING_CONFIG.wsReconnectInterval);
        } else {
            console.error("❌ Maximum reconnection attempts reached!");
            // Implement emergency stop if needed
        }
    });
}

export function initializeWebSocket() {
    createWebSocket();
}