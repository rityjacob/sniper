// Mock walletManager and dexManager at the very top
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