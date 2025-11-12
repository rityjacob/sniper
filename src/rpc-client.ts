/**
 * Direct Helius RPC Client - No SDK dependencies
 * Uses HTTP requests to interact with Solana blockchain via Helius RPC
 */

import fetch from 'node-fetch';
import { RPC_URL } from './config';

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any[];
}

export interface RpcResponse<T = any> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface AccountInfo {
  data: string[];
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch?: number;
}

export interface BlockhashResult {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SignatureStatus {
  slot: number;
  confirmations: number | null;
  err: any;
  status?: {
    Ok?: null;
    Err?: any;
  };
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
}

export class RpcClient {
  private rpcUrl: string;
  private requestId: number = 0;

  constructor(rpcUrl: string = RPC_URL) {
    this.rpcUrl = rpcUrl;
  }

  private async call<T>(method: string, params?: any[]): Promise<T> {
    const request: RpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params: params || []
    };

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: RpcResponse<T> = await response.json();

      if (data.error) {
        throw new Error(`RPC error: ${data.error.message} (code: ${data.error.code})`);
      }

      return data.result as T;
    } catch (error) {
      throw new Error(`RPC call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getBalance(pubkey: string): Promise<number> {
    const result = await this.call<number>('getBalance', [pubkey]);
    return result;
  }

  async getAccountInfo(pubkey: string): Promise<AccountInfo | null> {
    const result = await this.call<{
      data: string[];
      executable: boolean;
      lamports: number;
      owner: string;
      rentEpoch?: number;
    } | null>('getAccountInfo', [pubkey, { encoding: 'base64' }]);
    return result;
  }

  async getLatestBlockhash(commitment: 'processed' | 'confirmed' | 'finalized' = 'finalized'): Promise<BlockhashResult> {
    const result = await this.call<{
      value: BlockhashResult;
    }>('getLatestBlockhash', [{ commitment }]);
    return result.value;
  }

  async sendTransaction(transaction: string, options?: {
    skipPreflight?: boolean;
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
    maxRetries?: number;
  }): Promise<string> {
    const config: any = {
      encoding: 'base64',
      skipPreflight: options?.skipPreflight ?? false,
      preflightCommitment: options?.preflightCommitment ?? 'confirmed',
      maxRetries: options?.maxRetries ?? 3
    };

    const result = await this.call<string>('sendTransaction', [transaction, config]);
    return result;
  }

  async getSignatureStatus(signature: string): Promise<SignatureStatus | null> {
    const result = await this.call<{
      value: SignatureStatus | null;
    }>('getSignatureStatus', [signature, { searchTransactionHistory: false }]);
    return result.value;
  }

  async getSignatureStatuses(signatures: string[]): Promise<(SignatureStatus | null)[]> {
    const result = await this.call<{
      value: (SignatureStatus | null)[];
    }>('getSignatureStatuses', [signatures, { searchTransactionHistory: false }]);
    return result.value;
  }

  async getRecentPrioritizationFees(accounts?: string[]): Promise<Array<{
    slot: number;
    prioritizationFee: number;
  }>> {
    const params = accounts ? [{ accounts }] : [];
    const result = await this.call<Array<{
      slot: number;
      prioritizationFee: number;
    }>>('getRecentPrioritizationFees', params);
    return result;
  }

  async simulateTransaction(transaction: string, options?: {
    sigVerify?: boolean;
    commitment?: 'processed' | 'confirmed' | 'finalized';
  }): Promise<{
    err: any;
    logs: string[] | null;
    unitsConsumed?: number;
  }> {
    const config: any = {
      encoding: 'base64',
      sigVerify: options?.sigVerify ?? false,
      commitment: options?.commitment ?? 'processed'
    };

    const result = await this.call<{
      value: {
        err: any;
        logs: string[] | null;
        unitsConsumed?: number;
      };
    }>('simulateTransaction', [transaction, config]);
    return result.value;
  }
}

export const rpcClient = new RpcClient();

