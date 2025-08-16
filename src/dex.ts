import fetch, { Response } from 'node-fetch';
import { 
    DEX_CONFIG,
    TRANSACTION_CONFIG,
    SAFETY_CONFIG 
} from './config';
import { walletManager } from './wallet';
import { logger } from './utils/logger';
import { Connection, PublicKey, Transaction, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
}



class DexManager {
    private lastApiCall: number = 0;
    private readonly minApiCallInterval = 100; // 100ms between API calls

    private async rateLimitedFetch(url: string, options?: any): Promise<Response> {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCall;
        
        if (timeSinceLastCall < this.minApiCallInterval) {
            await new Promise(resolve => setTimeout(resolve, this.minApiCallInterval - timeSinceLastCall));
        }
        
        this.lastApiCall = Date.now();
        const response = await fetch(url, options);
        
        if (!response.ok) {
            let errorBody: any = '<unreadable>';
            const contentType = response.headers.get('content-type') || '';
            
            try {
                if (contentType.includes('application/json')) {
                    errorBody = await response.json();
                } else {
                    errorBody = await response.text();
                }
            } catch (err) {
                errorBody = '[Failed to parse error body]';
            }
            
            const fullError = {
                url,
                options,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: errorBody
            };
            
            logger.logError('dex', `API call failed: ${response.statusText}`, JSON.stringify(fullError, null, 2));
            console.error('🔴 Full API Error:');
            console.dir(fullError, { depth: null });
            
            const error = new Error(`API call failed: ${response.statusText}`);
            (error as any).details = fullError;
            throw error;
        }
        
        return response;
    }

    async getTokenPrice(tokenAddress: string): Promise<number> {
        try {
            const response = await this.rateLimitedFetch(
                `https://lite-api.jup.ag/price/v2?ids=${tokenAddress}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            const data = await response.json();
            const price = data.data?.[tokenAddress]?.price || 0;
            
            logger.logInfo('dex', 'Token price fetched', 
                `Token: ${tokenAddress}, Price: ${price} SOL`
            );
            
            return price;
        } catch (error: any) {
            console.error('🔴 Debug - Token Price Error:');
            console.dir(error, { depth: null });
            logger.logError('dex', 'Failed to get token price', error.message);
            throw error;
        }
    }

    private async getTokenLiquidity(tokenAddress: string): Promise<number> {
        try {
            const response = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/liquidity?token=${tokenAddress}`
            );
            const data = await response.json();
            const liquidity = data.liquidity || 0;
            
            logger.logInfo('dex', 'Token liquidity fetched', 
                `Token: ${tokenAddress}, Liquidity: ${liquidity} SOL`
            );
            
            return liquidity;
        } catch (error: any) {
            logger.logError('dex', 'Error fetching token liquidity', error.message);
            return 0;
        }
    }

    async checkLiquidity(tokenAddress: string): Promise<boolean> {
        try {
            const liquidity = await this.getTokenLiquidity(tokenAddress);
            // Log liquidity for debugging but don't restrict based on it
            logger.logInfo('dex', 'Token liquidity', 
                `Token: ${tokenAddress}, Liquidity: ${liquidity} SOL`
            );
            return true; // Always return true regardless of liquidity
        } catch (error: any) {
            logger.logError('dex', 'Error checking liquidity', error.message);
            return true; // Return true even on error to not block trades
        }
    }
    


    private async rebuildPumpFunTransaction(targetSignature: string, tokenAddress: string, amount: number): Promise<string> {
        try {
            logger.logInfo('dex', 'Rebuilding pump.fun transaction', 
                `Target signature: ${targetSignature}, Token: ${tokenAddress}`
            );

            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            
            // Get the target transaction
            const targetTransaction = await connection.getTransaction(targetSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });

            if (!targetTransaction) {
                throw new Error('Target transaction not found');
            }

            logger.logInfo('dex', 'Target transaction captured', 
                `Slot: ${targetTransaction.slot}, Block time: ${targetTransaction.blockTime}`
            );

            // Parse the transaction to extract relevant accounts and instruction data
            const message = targetTransaction.transaction.message;
            let instructions: any[];
            let accountKeys: string[];

            if ('instructions' in message) {
                // Legacy transaction
                instructions = message.instructions;
                accountKeys = message.accountKeys.map((key: PublicKey) => key.toString());
            } else {
                // Versioned transaction
                instructions = message.compiledInstructions;
                const accountKeysObj = message.getAccountKeys();
                accountKeys = [];
                for (let i = 0; i < accountKeysObj.length; i++) {
                    accountKeys.push(accountKeysObj.get(i)?.toString() || '');
                }
            }

            // Debug: Log all program IDs in the transaction
            const programIds = instructions.map((instruction: any) => accountKeys[instruction.programIdIndex]);
            console.log('Debug - Program IDs in transaction:', programIds);

            // Find pump.fun program instructions
            const pumpFunInstructions = instructions.filter((instruction: any) => {
                const programId = accountKeys[instruction.programIdIndex];
                // Pump.fun program IDs (main program and AMM program)
                return programId === 'PFund111111111111111111111111111111111111111111' || 
                       programId === 'troY36K7KUi61' ||
                       programId.startsWith('troY36'); // Handle full program ID
            });

            if (pumpFunInstructions.length === 0) {
                throw new Error('No pump.fun instructions found in target transaction');
            }

            logger.logInfo('dex', 'Pump.fun instructions found', 
                `Count: ${pumpFunInstructions.length}`
            );

            // Extract relevant accounts from the target transaction
            const relevantAccounts = pumpFunInstructions.map((instruction: any) => {
                return instruction.accounts.map((accountIndex: number) => 
                    accountKeys[accountIndex]
                );
            }).flat();

            // Create a new transaction with the same structure but for our wallet
            const transaction = new Transaction();
            
            // Add the pump.fun instructions with our wallet as the user
            pumpFunInstructions.forEach((instruction: any) => {
                const accounts = instruction.accounts.map((accountIndex: number) => {
                    const accountKey = accountKeys[accountIndex];
                    // Replace the target wallet with our wallet where appropriate
                    if (accountKey === targetTransaction.meta?.postTokenBalances?.[0]?.owner) {
                        return walletManager.getPublicKey();
                    }
                    return new PublicKey(accountKey);
                });

                transaction.add({
                    programId: new PublicKey(accountKeys[instruction.programIdIndex]),
                    keys: accounts.map((account: PublicKey) => ({
                        pubkey: account,
                        isSigner: account.equals(walletManager.getPublicKey()),
                        isWritable: true
                    })),
                    data: Buffer.from(instruction.data)
                });
            });

            // Set recent blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = walletManager.getPublicKey();

            logger.logInfo('dex', 'Transaction rebuilt', 'Signing and sending');

            // Sign and send the transaction
            const signature = await walletManager.signAndSendTransaction(transaction, {
                skipPreflight: true,
                maxRetries: 3,
                preflightCommitment: 'processed'
            });

            logger.logTransaction(signature, tokenAddress, amount.toString(), 'success');
            logger.logInfo('dex', 'Rebuilt transaction successful', `Signature: ${signature}`);
            
            return signature;
        } catch (error: any) {
            console.error('Debug - Rebuild Transaction Error:', {
                error: error.message,
                targetSignature,
                tokenAddress,
                amount
            });
            throw error;
        }
    }

    async executeSwap(tokenAddress: string, amount: number, originalPrice?: number, targetSignature?: string): Promise<string> {
        let quoteBody: any;
        let swapBody: any;
        
        try {
            logger.logInfo('dex', 'Executing swap', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL`
            );

            // Check wallet balance first
            const balance = await walletManager.getBalance();
            const requiredBalance = amount + TRANSACTION_CONFIG.minSolBalance;
            
            if (balance < requiredBalance) {
                const error = `Insufficient balance. Have: ${balance} SOL, Need: ${requiredBalance} SOL`;
                logger.logError('dex', 'Insufficient balance for swap', error);
                throw new Error(error);
            }

            // Check price movement if original price is provided
            if (originalPrice) {
                const currentPrice = await this.getTokenPrice(tokenAddress);
                const priceChange = ((currentPrice - originalPrice) / originalPrice) * 100;
                
                logger.logInfo('dex', 'Price movement check', 
                    `Original: ${originalPrice}, Current: ${currentPrice}, Change: ${priceChange.toFixed(2)}%`
                );

                if (priceChange >= 100) {
                    const error = `Price has moved too much (${priceChange.toFixed(2)}%). Skipping trade.`;
                    logger.logWarning('dex', 'Trade skipped due to price movement', error);
                    throw new Error(error);
                }
            }

            // Try rebuilding the transaction first (on-chain approach)
            if (targetSignature) {
                try {
                    logger.logInfo('dex', 'Attempting to rebuild transaction first', `Target signature: ${targetSignature}`);
                    console.log('🔄 Rebuilding transaction on-chain...');
                    return await this.rebuildPumpFunTransaction(targetSignature, tokenAddress, amount);
                } catch (rebuildError: any) {
                    logger.logWarning('dex', 'Transaction rebuild failed, trying Jupiter', rebuildError.message);
                    console.log('🔄 On-chain rebuild failed, falling back to Jupiter...');
                }
            }

            // Fallback to Jupiter API
            let jupiterError: any;
            try {
                logger.logInfo('dex', 'Attempting Jupiter swap', `Token: ${tokenAddress}`);
                
                const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
                const wallet = walletManager.getCurrentWallet();

                // Get quote from Jupiter with optimized settings for speed and lower slippage
                const quoteUrl = `${DEX_CONFIG.jupiterApiUrl}/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${Math.floor(amount * 1e9)}&onlyDirectRoutes=true&asLegacyTransaction=true&slippageBps=${Math.floor(TRANSACTION_CONFIG.maxSlippage * 100)}`;
                
                console.log('Debug - Jupiter Quote Request:', {
                    url: quoteUrl,
                    amount,
                    tokenAddress,
                    originalPrice
                });

                const quoteResponse = await this.rateLimitedFetch(
                    quoteUrl,
                    {
                        method: 'GET',
                        headers: { 
                            'Accept': 'application/json'
                        },
                        redirect: 'follow'
                    }
                );
                
                const quote = await quoteResponse.json();
                
                if (!quote.outAmount || !quote.inAmount) {
                    console.error('Debug - Invalid Jupiter Quote Response:', quote);
                    throw new Error('Invalid quote received from Jupiter');
                }

                // Get swap transaction with optimized settings for speed
                const swapUrl = `${DEX_CONFIG.jupiterApiUrl}/swap/v1/swap`;
                swapBody = {
                    userPublicKey: walletManager.getPublicKey().toString(),
                    quoteResponse: quote,
                    prioritizationFeeLamports: {
                        priorityLevelWithMaxLamports: {
                            maxLamports: TRANSACTION_CONFIG.priorityFee,
                            priorityLevel: "veryHigh"
                        }
                    },
                    dynamicComputeUnitLimit: true,
                    asLegacyTransaction: true,
                    skipUserAccountsCheck: true
                };

                console.log('Debug - Jupiter Swap Request:', {
                    url: swapUrl,
                    body: swapBody
                });

                const swapResponse = await this.rateLimitedFetch(
                    swapUrl,
                    {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(swapBody)
                    }
                );
                
                const swapTransaction = await swapResponse.json();
                
                if (!swapTransaction.swapTransaction) {
                    console.error('Debug - Invalid Jupiter Swap Response:', swapTransaction);
                    throw new Error('Invalid swap transaction received from Jupiter');
                }

                logger.logInfo('dex', 'Jupiter swap transaction prepared', 'Executing transaction');
                
                // Deserialize and execute the transaction
                const transaction = VersionedTransaction.deserialize(
                    Buffer.from(swapTransaction.swapTransaction, 'base64')
                );
                
                // Execute the swap with retry logic
                let retries = 0;
                while (retries < TRANSACTION_CONFIG.maxRetries) {
                    try {
                        const signature = await walletManager.signAndSendTransaction(transaction, {
                            skipPreflight: true,
                            maxRetries: 3,
                            preflightCommitment: 'processed'
                        });
                        logger.logTransaction(signature, tokenAddress, amount.toString(), 'success');
                        logger.logInfo('dex', 'Jupiter swap successful', `Signature: ${signature}`);
                        return signature;
                    } catch (error: any) {
                        if (error.message.includes('0x1771') && retries < TRANSACTION_CONFIG.maxRetries - 1) {
                            retries++;
                            await new Promise(resolve => setTimeout(resolve, 50));
                            continue;
                        }
                        throw error;
                    }
                }
                
                throw new Error('Max retries exceeded for Jupiter swap execution');
            } catch (error: any) {
                jupiterError = error;
                logger.logError('dex', 'Jupiter swap also failed', jupiterError.message);
                console.error('🔴 Jupiter also failed:', jupiterError.message);
            }

            // All methods failed
            const errorMessage = `All swap methods failed. Jupiter error: ${jupiterError?.message}`;
            console.log('❌ NOT SUPPORTED: All swap methods failed for this token');
            logger.logError('dex', 'Token not supported by any method', errorMessage);
            throw new Error('Token not supported by any method');
        } catch (error: any) {
            console.error('Debug - Final Swap Error:', {
                error: error.message,
                tokenAddress,
                amount,
                status: error.status,
                response: error.response,
                logs: error.logs,
                requestBody: {
                    quote: quoteBody,
                    swap: swapBody
                }
            });
            const errorMessage = error.message || 'Unknown error';
            logger.logTransaction('pending', tokenAddress, amount.toString(), 'failed', errorMessage);
            throw error;
        }
    }

    public async calculatePriceImpact(
        tokenAddress: string,
        amount: number
    ): Promise<number> {
        try {
            // For devnet testing, simulate a price impact
            // This is a simplified model - in production, you'd use real DEX data
            const simulatedLiquidity = 1000; // Simulated liquidity in SOL
            const priceImpact = (amount / simulatedLiquidity) * 100;
            
            logger.logInfo('dex', 'Price impact calculated', 
                `Token: ${tokenAddress}, Amount: ${amount} SOL, Impact: ${priceImpact.toFixed(2)}%`
            );
            
            return priceImpact;
        } catch (error: any) {
            logger.logError('dex', 'Error calculating price impact', error.message);
            throw error;
        }
    }

    async sellToken(tokenAddress: string, tokenAmount: number): Promise<string> {
        try {
            // Check balance before selling
            const balance = await this.getTokenBalance(tokenAddress);
            if (balance < tokenAmount) {
                throw new Error(`Insufficient balance. Have: ${balance}, Trying to sell: ${tokenAmount}`);
            }

            logger.logInfo('dex', 'Executing sell', 
                `Token: ${tokenAddress}, Amount: ${tokenAmount} tokens`
            );

            // Get quote from Jupiter
            const quoteResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
            );
            
            const quote = await quoteResponse.json();
            logger.logInfo('dex', 'Sell quote received', JSON.stringify(quote, null, 2));
            
            // Validate quote
            if (!quote.outAmount || !quote.inAmount) {
                throw new Error('Invalid quote received from Jupiter');
            }

            // Get swap transaction
            const swapResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/swap`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        quoteResponse: quote,
                        userPublicKey: walletManager.getPublicKey().toString(),
                        wrapUnwrapSOL: true,
                        computeUnitPriceMicroLamports: TRANSACTION_CONFIG.computeUnitPrice,
                        computeUnitLimit: TRANSACTION_CONFIG.computeUnitLimit,
                        asLegacyTransaction: true
                    })
                }
            );
            
            const swapTransaction = await swapResponse.json();
            
            if (!swapTransaction.swapTransaction) {
                throw new Error('Invalid swap transaction received from Jupiter');
            }

            logger.logInfo('dex', 'Sell transaction prepared', 'Executing transaction');
            
            // Deserialize the transaction
            const transaction = Transaction.from(Buffer.from(swapTransaction.swapTransaction, 'base64'));
            
            // Execute the swap
            const signature = await walletManager.signAndSendTransaction(transaction);
            
            logger.logTransaction(signature, tokenAddress, tokenAmount.toString(), 'success');
            return signature;
        } catch (error: any) {
            logger.logTransaction('pending', tokenAddress, tokenAmount.toString(), 'failed', error.message);
            throw error;
        }
    }

    async getTokenBalance(tokenAddress: string): Promise<number> {
        try {
            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            const wallet = walletManager.getCurrentWallet();
            const tokenPublicKey = new PublicKey(tokenAddress);
            const walletPublicKey = walletManager.getPublicKey();
            
            // Get the associated token account
            const associatedTokenAccount = await PublicKey.findProgramAddress(
                [
                    walletPublicKey.toBuffer(),
                    TOKEN_PROGRAM_ID.toBuffer(),
                    tokenPublicKey.toBuffer(),
                ],
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            // Get token balance
            const balance = await connection.getTokenAccountBalance(associatedTokenAccount[0]);
            
            logger.logInfo('dex', 'Token balance fetched', 
                `Token: ${tokenAddress}, Balance: ${balance.value.uiAmount}`
            );
            
            return balance.value.uiAmount || 0;
        } catch (error: any) {
            logger.logError('dex', 'Error fetching token balance', error.message);
            return 0;
        }
    }

    async calculateExpectedReturn(tokenAddress: string, tokenAmount: number): Promise<{
        expectedSol: number;
        priceImpact: number;
        minimumReceived: number;
    }> {
        try {
            const quoteResponse = await this.rateLimitedFetch(
                `${DEX_CONFIG.jupiterApiUrl}/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=${TRANSACTION_CONFIG.maxSlippage * 100}`
            );
            
            const quote = await quoteResponse.json();
            const priceImpact = await this.calculatePriceImpact(tokenAddress, tokenAmount);
            const minimumReceived = quote.outAmount * (1 - TRANSACTION_CONFIG.maxSlippage);
            
            return {
                expectedSol: quote.outAmount / 1e9, // Convert lamports to SOL
                priceImpact,
                minimumReceived: minimumReceived / 1e9
            };
        } catch (error: any) {
            logger.logError('dex', 'Error calculating expected return', error.message);
            throw error;
        }
    }

    async sellPercentageOfHoldings(tokenAddress: string, percentage: number): Promise<string> {
        try {
            if (percentage <= 0 || percentage > 100) {
                throw new Error('Percentage must be between 0 and 100');
            }

            const balance = await this.getTokenBalance(tokenAddress);
            const amountToSell = Math.floor(balance * (percentage / 100));

            if (amountToSell <= 0) {
                throw new Error('No tokens available to sell');
            }

            const expectedReturn = await this.calculateExpectedReturn(tokenAddress, amountToSell);
            logger.logInfo('dex', 'Selling percentage of holdings', 
                `Token: ${tokenAddress}, Percentage: ${percentage}%, Amount: ${amountToSell}, Expected SOL: ${expectedReturn.expectedSol}`
            );

            return await this.sellToken(tokenAddress, amountToSell);
        } catch (error: any) {
            logger.logError('dex', 'Error selling percentage of holdings', error.message);
            throw error;
        }
    }
}

export const dexManager = new DexManager();
            