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
  const strData = data.toString();
  console.log(strData);

  try {
    const parsed = JSON.parse(strData);

    const lamports = parsed?.params?.result?.value?.lamports;

    if (lamports !== undefined) {
      console.log("new balance: " + lamports / 1000000000 + " SOL");
    } else {
      console.log("lamports not found in message");
    }

  } catch (e) {
    console.error("Failed to parse message:", e);
  }
});

ws.on("error", (error: Error) => {
  console.log("error: " + error.message);
  console.log(JSON.stringify(error));
});

ws.on("close", () => {
  console.log("connection closed! Bye!");
});