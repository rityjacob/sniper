import WebSocket from "ws";

const ACCOUNT = "3qBKimmvwd2HaXCwemH62SDqgWtXXcZ2q4321SEWBSw5";
const ENDPOINT = "wss://api.devnet.solana.com/";
const LAMPORTS_PER_SOL = 1_000_000_000;

let pingInterval: NodeJS.Timeout;

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
  const ws = new WebSocket(ENDPOINT);

  ws.on("open", () => {
    console.log("✅ new connection!");
    subscribeToAccount(ws, ACCOUNT);

    // Start ping interval
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log("📡 Sent ping");
      }
    }, 30000);
  });

  ws.on("message", (data) => {
    console.log("📥 New message:");
    const strData = data.toString();
    console.log(strData);

    try {
      const parsed = JSON.parse(strData);
      const lamports = parsed?.params?.result?.value?.lamports;

      if (lamports !== undefined) {
        console.log("💰 new balance: " + lamports / LAMPORTS_PER_SOL + " SOL");
      } else {
        console.log("lamports not found in message");
      }

    } catch (e) {
      console.error("❌ Failed to parse message:", e);
    }
  });

  ws.on("error", (error: Error) => {
    console.log("❗ error: " + error.message);
  });

  ws.on("close", () => {
    console.log("🔌 connection closed! Reconnecting in 5 seconds...");
    clearInterval(pingInterval);
    setTimeout(createWebSocket, 5000);
  });
}

createWebSocket();