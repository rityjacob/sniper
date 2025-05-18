import WebSocket from "ws";

function subscribeToAccount(ws: WebSocket, account: string){
  const requestdata= {
    "jsonrpc": "2.0",
    "id": 1903,
    "method": "accountSubscribe",
    "params": [
      account,
      {
        "encoding": "jsonParsed",
        "commitment": "confirmed"
      }
    ]
  };
  ws.send(JSON.stringify(requestdata))
}

const ws = new WebSocket("wss://api.devnet.solana.com/");

ws.on("open", () => {
  console.log("new connection!");

  subscribeToAccount(ws, "3qBKimmvwd2HaXCwemH62SDqgWtXXcZ2q4321SEWBSw5")
});

ws.on("message", (data) => {
  console.log("New message:");
  console.log(data.toString());
});

ws.on("error", (error: Error) => {
  console.log("error: " + error.message);
  console.log(JSON.stringify(error));
});

ws.on("close", () => {
  console.log("connection closed! Bye!");
});