import fs from "fs";
import bs58 from "bs58";
import path from "path";
// Absolute path to your wallet file
const walletPath = path.resolve("/Users/rityjacob/dummy-wallet2.json");
console.log("🔍 Wallet file path:", walletPath);
try {
    const rawData = fs.readFileSync(walletPath, "utf-8");
    console.log("📄 Raw wallet data:", rawData);
    // Clean the data by removing any trailing characters
    const cleanData = rawData.trim().replace(/%$/, '');
    console.log("🧹 Cleaned data:", cleanData);
    const secretKey = Uint8Array.from(JSON.parse(cleanData));
    console.log("🔑 Secret key length:", secretKey.length);
    const base58Key = bs58.encode(secretKey);
    console.log("✅ Your private key in base58:");
    console.log(base58Key);
}
catch (err) {
    console.error("❌ Failed to read or convert wallet:", err.message);
    console.error("Error details:", err);
}
