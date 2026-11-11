import { Connection } from "@solana/web3.js";

let connection: Connection | undefined;

/** One shared RPC connection for trading and the dashboard. */
export function getConnection(rpcUrl: string): Connection {
  connection ??= new Connection(rpcUrl, "confirmed");
  return connection;
}
