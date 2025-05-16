import { Connection } from '@solana/web3.js';
import WebSocket from 'ws';

// Initialize Solana connection
const connection = new Connection('wss://api.mainnet-beta.solana.com', 'confirmed');

// Create WebSocket connection
const ws = new WebSocket('wss://api.mainnet-beta.solana.com');

ws.on('open', () => {
    console.log('Connected to Solana WebSocket');
    
    // Subscribe to program notifications
    const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'programSubscribe',
        params: [
            // Add program ID here
            {
                encoding: 'jsonParsed',
                commitment: 'confirmed'
            }
        ]
    };
    
    ws.send(JSON.stringify(subscribeMessage));
});

ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('Received:', message);
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

ws.on('close', () => {
    console.log('WebSocket connection closed');
});
