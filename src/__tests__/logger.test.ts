import { logger } from '../utils/logger';

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should log info messages', () => {
    logger.logInfo('test', 'Test message', 'Test details');
    
    expect(mockConsoleLog).toHaveBeenCalledWith('[INFO][test] Test message');
    expect(mockConsoleLog).toHaveBeenCalledWith('Details: Test details');
  });

  test('should log warning messages', () => {
    logger.logWarning('test', 'Test warning', 'Warning details');
    
    expect(mockConsoleWarn).toHaveBeenCalledWith('[WARNING][test] Test warning');
    expect(mockConsoleWarn).toHaveBeenCalledWith('Details: Warning details');
  });

  test('should log error messages', () => {
    logger.logError('test', 'Test error', 'Error details');
    
    expect(mockConsoleError).toHaveBeenCalledWith('[ERROR][test] Test error');
    expect(mockConsoleError).toHaveBeenCalledWith('Details: Error details');
  });

  test('should log transaction messages', () => {
    logger.logTransaction('signature123', 'token456', '0.1', 'success');
    
    expect(mockConsoleLog).toHaveBeenCalledWith('[TRANSACTION] SUCCESS: signature123 - token456 - 0.1 SOL');
  });

  test('should log failed transactions with error', () => {
    logger.logTransaction('signature123', 'token456', '0.1', 'failed', 'Transaction failed');
    
    expect(mockConsoleLog).toHaveBeenCalledWith('[TRANSACTION] FAILED: signature123 - token456 - 0.1 SOL');
    expect(mockConsoleError).toHaveBeenCalledWith('Error: Transaction failed');
  });
});
