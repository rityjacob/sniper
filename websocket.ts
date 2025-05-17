import { WebSocket } from "ws";

const ws = new WebSocket("wss://api.devnet.solana.com/");

ws.on("open", () => {
  console.log("new connection!");
});

ws.on("message", (data: WebSocket.Data) => {
  console.log(data);
});

ws.on("error", (error: Error) => {
  console.log("error: " + error.message);
  console.log(JSON.stringify(error));
});

ws.on("close", () => {
  console.log("connection closed");
});