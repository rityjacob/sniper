import { Connection, PublicKey } from '@solana/web3.js';
import { RPC_URL } from '../config';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

async function checkToken() {
    try {
        const connection = new Connection(RPC_URL, 'confirmed');
        const tokenAddress = '4dP5ACh9XBhuKB1TJuR84F4pVQJJkfyf5mBn4Yoepump';
        
        console.log('🔍 Checking token on devnet...');
        console.log(`Token Address: ${tokenAddress}`);

        // Check if the token account exists
        const tokenInfo = await connection.getAccountInfo(new PublicKey(tokenAddress));
        
        if (tokenInfo) {
            console.log('\n✅ Token exists on devnet');
            console.log('Owner:', tokenInfo.owner.toString());
            console.log('Size:', tokenInfo.data.length, 'bytes');
        } else {
            console.log('\n❌ Token not found on devnet');
        }

    } catch (error) {
        console.error('Error checking token:', error);
    }
}

checkToken().catch(console.error); 