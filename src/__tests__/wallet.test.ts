// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => ({
    Connection: jest.fn().mockImplementation(() => ({
        getBalance: jest.fn(),
        getLatestBlockhash: jest.fn(),
        sendRawTransaction: jest.fn(),
        confirmTransaction: jest.fn(),
        getFeeForMessage: jest.fn()
    })),
    Keypair: {
        fromSecretKey: jest.fn()
    },
    Transaction: jest.fn().mockImplementation(() => ({
        recentBlockhash: '',
        sign: jest.fn(),
        serialize: jest.fn()
    }))
}));

// Mock bs58
jest.mock('bs58', () => ({
    decode: jest.fn()
}));

import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { walletManager, WalletManager } from '../wallet';
import { TRANSACTION_CONFIG, WALLET_PRIVATE_KEY } from '../config';
import bs58 from 'bs58';

// Mock walletManager before importing commandHandler
jest.mock('../wallet', () => ({
  walletManager: {
    getBalance: jest.fn().mockResolvedValue(5),
    getPublicKey: jest.fn().mockReturnValue({ toString: () => 'mock-public-key' }),
    signAndSendTransaction: jest.fn(),
    getLatestBlockhash: jest.fn(),
  }
}));

jest.mock('../dex', () => ({
  dexManager: {
    executeSwap: jest.fn()
  }
}));

import { commandHandler } from '../commands';
import { dexManager } from '../dex';

describe('WalletManager', () => {
    let mockConnection: jest.Mocked<Connection>;
    let mockKeypair: jest.Mocked<Keypair>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConnection = new Connection('mock-url') as jest.Mocked<Connection>;
        mockKeypair = {
            publicKey: { toString: () => 'mock-public-key' }
        } as unknown as jest.Mocked<Keypair>;
        
        // Mock the wallet's connection and keypair
        (walletManager as any).connection = mockConnection;
        (walletManager as any).wallet = mockKeypair;
    });

    describe('getBalance', () => {
        it('should return balance in SOL', async () => {
            const mockBalance = 1000000000; // 1 SOL in lamports
            mockConnection.getBalance.mockResolvedValue(mockBalance);

            const balance = await walletManager.getBalance();
            expect(balance).toBe(1); // Should be converted to SOL
            expect(mockConnection.getBalance).toHaveBeenCalledWith(mockKeypair.publicKey);
        });

        it('should handle errors', async () => {
            const error = new Error('Failed to get balance');
            mockConnection.getBalance.mockRejectedValue(error);

            await expect(walletManager.getBalance()).rejects.toThrow('Failed to get balance');
        });
    });

    describe('checkMinimumBalance', () => {
        it('should return true when balance is sufficient', async () => {
            const mockBalance = TRANSACTION_CONFIG.minSolBalance + 1;
            mockConnection.getBalance.mockResolvedValue(mockBalance * 1e9);

            const result = await walletManager.checkMinimumBalance();
            expect(result).toBe(true);
        });

        it('should return false when balance is insufficient', async () => {
            const mockBalance = TRANSACTION_CONFIG.minSolBalance - 1;
            mockConnection.getBalance.mockResolvedValue(mockBalance * 1e9);

            const result = await walletManager.checkMinimumBalance();
            expect(result).toBe(false);
        });
    });

    describe('signAndSendTransaction', () => {
        const mockTransaction = new Transaction();
        const mockSignature = 'mock-signature';
        const mockBlockhash = 'mock-blockhash';
        const mockLastValidBlockHeight = 100;
        const mockSerializedTransaction = Buffer.from('mock-transaction');

        beforeEach(() => {
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: mockBlockhash,
                lastValidBlockHeight: mockLastValidBlockHeight
            });
            mockConnection.sendRawTransaction.mockResolvedValue(mockSignature);
            mockConnection.confirmTransaction.mockResolvedValue({ 
                value: { err: null },
                context: { slot: 1 }
            });
            // Mock transaction serialization
            (mockTransaction as any).serialize = jest.fn().mockReturnValue(mockSerializedTransaction);
        });

        it('should sign and send transaction successfully', async () => {
            const signature = await walletManager.signAndSendTransaction(mockTransaction);

            expect(signature).toBe(mockSignature);
            expect(mockConnection.getLatestBlockhash).toHaveBeenCalled();
            expect(mockTransaction.sign).toHaveBeenCalledWith(mockKeypair);
            expect(mockConnection.sendRawTransaction).toHaveBeenCalledWith(
                mockSerializedTransaction,
                {
                    skipPreflight: false,
                    maxRetries: TRANSACTION_CONFIG.maxRetries,
                    preflightCommitment: 'confirmed'
                }
            );
            expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
                {
                    signature: mockSignature,
                    blockhash: mockBlockhash,
                    lastValidBlockHeight: mockLastValidBlockHeight
                },
                'confirmed'
            );
        });

        it('should handle transaction failure', async () => {
            const error = new Error('Transaction failed');
            mockConnection.sendRawTransaction.mockRejectedValue(error);

            await expect(walletManager.signAndSendTransaction(mockTransaction))
                .rejects.toThrow('Transaction failed');
        });

        it('should handle confirmation failure', async () => {
            mockConnection.confirmTransaction.mockResolvedValue({ 
                value: { err: 'confirmation failed' },
                context: { slot: 1 }
            });

            await expect(walletManager.signAndSendTransaction(mockTransaction))
                .rejects.toThrow('Transaction confirmation failed');
        });
    });

    describe('calculateOptimalTradeAmount', () => {
        it('should calculate optimal amount based on balance and max trade size', async () => {
            const mockBalance = 10; // 10 SOL
            mockConnection.getBalance.mockResolvedValue(mockBalance * 1e9);

            const optimalAmount = await walletManager.calculateOptimalTradeAmount('mock-token');
            
            // Should be min of:
            // 1. balance - minSolBalance (10 - 0.01 = 9.99)
            // 2. maxSolPerTrade (6)
            expect(optimalAmount).toBe(6); // maxSolPerTrade is the limiting factor
            expect(mockConnection.getBalance).toHaveBeenCalledWith(mockKeypair.publicKey);
        });

        it('should handle balance below minimum', async () => {
            const mockBalance = 0.005; // 0.005 SOL
            mockConnection.getBalance.mockResolvedValue(mockBalance * 1e9);

            const optimalAmount = await walletManager.calculateOptimalTradeAmount('mock-token');
            
            // Should be 0 since balance - minSolBalance would be negative
            expect(optimalAmount).toBe(0);
        });

        it('should handle errors', async () => {
            const error = new Error('Failed to get balance');
            mockConnection.getBalance.mockRejectedValue(error);

            await expect(walletManager.calculateOptimalTradeAmount('mock-token'))
                .rejects.toThrow('Failed to get balance');
        });
    });

    describe('initializeWallet', () => {
        it('should handle invalid private key', () => {
            // Mock bs58.decode to throw an error
            (bs58.decode as jest.Mock).mockImplementation(() => {
                throw new Error('Invalid private key');
            });

            // Create a new instance to trigger initializeWallet
            expect(() => new WalletManager()).toThrow('Invalid private key');
            expect(bs58.decode).toHaveBeenCalledWith(WALLET_PRIVATE_KEY);
        });
    });

    describe('estimateTransactionFee', () => {
        const mockFee = 5000; // 5000 lamports

        beforeEach(() => {
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: 'mock-blockhash',
                lastValidBlockHeight: 100
            });
            mockConnection.getFeeForMessage.mockResolvedValue({
                value: mockFee,
                context: { slot: 1 }
            });
            // Mock Transaction's add method
            ((Transaction as unknown) as jest.Mock).mockImplementation(() => ({
                add: jest.fn().mockReturnThis(),
                recentBlockhash: '',
                compileMessage: jest.fn().mockReturnValue('mock-message')
            }));
        });

        it('should estimate transaction fee in SOL', async () => {
            const fee = await walletManager.estimateTransactionFee();
            
            expect(fee).toBe(mockFee / 1e9); // Convert lamports to SOL
            expect(mockConnection.getLatestBlockhash).toHaveBeenCalled();
            expect(mockConnection.getFeeForMessage).toHaveBeenCalled();
        });

        it('should handle getLatestBlockhash error', async () => {
            const error = new Error('Failed to get blockhash');
            mockConnection.getLatestBlockhash.mockRejectedValue(error);

            await expect(walletManager.estimateTransactionFee())
                .rejects.toThrow('Failed to get blockhash');
        });

        it('should handle getFeeForMessage error', async () => {
            const error = new Error('Failed to estimate fee');
            mockConnection.getFeeForMessage.mockRejectedValue(error);

            await expect(walletManager.estimateTransactionFee())
                .rejects.toThrow('Failed to estimate fee');
        });

        it('should handle invalid fee response', async () => {
            // Mock getLatestBlockhash to succeed
            (mockConnection.getLatestBlockhash as jest.Mock).mockResolvedValue({
                blockhash: 'mock-blockhash',
                lastValidBlockHeight: 100
            });

            // Mock getFeeForMessage to return null
            (mockConnection.getFeeForMessage as jest.Mock).mockResolvedValue({
                value: null,
                context: { slot: 1 }
            });

            const fee = await walletManager.estimateTransactionFee();
            expect(fee).toBe(0);
        });
    });
});

describe('Manual Buy Command', () => {
  it('should execute a buy and return a success message', async () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const solAmount = 1.5;
    const mockSignature = 'mock_signature_123';
    (dexManager.executeSwap as jest.Mock).mockResolvedValue(mockSignature);

    const response = await commandHandler.handleCommand(`!buy ${tokenAddress} ${solAmount}`);

    expect(response).toContain('✅ Buy order placed!');
    expect(response).toContain(tokenAddress);
    expect(response).toContain(`${solAmount} SOL`);
    expect(response).toContain(mockSignature);
  });

  it('should return an error for invalid SOL amount', async () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const response = await commandHandler.handleCommand(`!buy ${tokenAddress} -1`);
    expect(response).toContain('Invalid SOL amount');
  });

  it('should return usage for missing arguments', async () => {
    const response = await commandHandler.handleCommand('!buy');
    expect(response).toContain('Usage:');
  });
}); 