import { RPC_URL, WS_URL, TARGET_WALLET_ADDRESS, WALLET_PRIVATE_KEY } from '../config';

describe('Configuration', () => {
  test('should have required environment variables', () => {
    expect(RPC_URL).toBeDefined();
    expect(WS_URL).toBeDefined();
    expect(TARGET_WALLET_ADDRESS).toBeDefined();
    expect(WALLET_PRIVATE_KEY).toBeDefined();
  });

  test('should have valid RPC URL format', () => {
    expect(RPC_URL).toMatch(/^https?:\/\//);
  });

  test('should have valid WebSocket URL format', () => {
    expect(WS_URL).toMatch(/^wss?:\/\//);
  });

  test('should have valid wallet address format', () => {
    expect(TARGET_WALLET_ADDRESS).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
