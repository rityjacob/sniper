import axios from 'axios';
import { buyPrices } from '../profitTracker';

const fakeTokenMint = 'FAKE_TOKEN_MINT';
const fakeAmountInLamports = 1 * 1e9; // 1 SOL
const fakeCurrentPrice = 1; // 1 SOL per token

async function simulateBuy() {
  // Simulate webhook payload
  const payload = {
    type: 'SWAP',
    events: {
      swap: {
        tokenOut: fakeTokenMint,
        amountIn: fakeAmountInLamports
      }
    }
  };

  // Set initial buy price in the tracker (simulate DEX price fetch)
  buyPrices[fakeTokenMint] = { price: fakeCurrentPrice, amount: 1 };

  // Send webhook to local server
  await axios.post('http://localhost:3000/webhook', payload);
  console.log('✅ Simulated buy webhook sent.');
}

function simulatePriceIncrease() {
  if (buyPrices[fakeTokenMint]) {
    buyPrices[fakeTokenMint].price = buyPrices[fakeTokenMint].price * 1.5;
    console.log('✅ Simulated price increase to 1.5x.');
  }
}

async function runTest() {
  await simulateBuy();
  setTimeout(() => {
    simulatePriceIncrease();
    // Wait for the interval in server.ts to trigger the sell
    setTimeout(() => {
      console.log('✅ Test complete. Check logs for auto-sell.');
      process.exit(0);
    }, 70 * 1000); // Wait a bit longer than the interval
  }, 2000);
}

runTest(); 