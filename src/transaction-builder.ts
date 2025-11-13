/**
 * Transaction Builder - Manual transaction construction without SDK
 */

import { rpcClient, BlockhashResult } from './rpc-client';
import { Keypair, signMessage, publicKeyToBase58 } from './crypto-utils';
import bs58 from 'bs58';

export interface Instruction {
  programId: Uint8Array;
  keys: AccountMeta[];
  data: Uint8Array;
}

export interface AccountMeta {
  pubkey: Uint8Array;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Transaction {
  signatures: Array<{
    signature: Uint8Array | null;
    publicKey: Uint8Array;
  }>;
  instructions: Instruction[];
  recentBlockhash?: string;
  feePayer?: Uint8Array;
}

const SYSTEM_PROGRAM_ID = bs58.decode('11111111111111111111111111111111');
const COMPUTE_BUDGET_PROGRAM_ID = bs58.decode('ComputeBudget111111111111111111111111111111');

/**
 * Create a new transaction
 */
export function createTransaction(): Transaction {
  return {
    signatures: [],
    instructions: []
  };
}

/**
 * Add instruction to transaction
 */
export function addInstruction(tx: Transaction, instruction: Instruction): void {
  tx.instructions.push(instruction);
}

/**
 * Create compute budget instruction for setting compute unit limit
 */
export function createComputeUnitLimitInstruction(units: number): Instruction {
  // Instruction discriminator: 2 (setComputeUnitLimit)
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(2, 0); // Instruction discriminator
  const unitsBuffer = Buffer.allocUnsafe(4);
  unitsBuffer.writeUInt32LE(units, 0);
  const fullData = Buffer.concat([data, unitsBuffer] as any);

  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data: new Uint8Array(fullData.buffer, fullData.byteOffset, fullData.byteLength)
  };
}

/**
 * Create compute budget instruction for setting compute unit price
 */
export function createComputeUnitPriceInstruction(microLamports: number): Instruction {
  // Instruction discriminator: 3 (setComputeUnitPrice)
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(3, 0); // Instruction discriminator
  const priceBuffer = Buffer.allocUnsafe(8);
  priceBuffer.writeBigUInt64LE(BigInt(microLamports), 0);
  const fullData = Buffer.concat([data, priceBuffer] as any);

  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data: new Uint8Array(fullData.buffer, fullData.byteOffset, fullData.byteLength)
  };
}

/**
 * Set recent blockhash and fee payer
 */
export async function setTransactionBlockhash(
  tx: Transaction,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'finalized'
): Promise<void> {
  const blockhashResult = await rpcClient.getLatestBlockhash(commitment);
  tx.recentBlockhash = blockhashResult.blockhash;
}

/**
 * Sign transaction with keypair
 */
export function signTransaction(tx: Transaction, keypair: Keypair): void {
  if (!tx.recentBlockhash) {
    throw new Error('Transaction must have a recent blockhash before signing');
  }

  // Serialize message
  const messageBuffer = serializeMessage(tx);
  
  // Convert Buffer to Uint8Array for signing
  const message = new Uint8Array(messageBuffer);
  
  // Sign message
  const signature = signMessage(message, keypair.secretKey);

  // Add signature to transaction
  const existingSigIndex = tx.signatures.findIndex(
    sig => publicKeyToBase58(sig.publicKey) === publicKeyToBase58(keypair.publicKey)
  );

  if (existingSigIndex >= 0) {
    tx.signatures[existingSigIndex].signature = signature;
  } else {
    tx.signatures.push({
      signature,
      publicKey: keypair.publicKey
    });
  }
}

/**
 * Serialize transaction to base64 for RPC
 */
export function serializeTransaction(tx: Transaction): string {
  if (!tx.recentBlockhash) {
    throw new Error('Transaction must have a recent blockhash');
  }

  // Serialize message
  const message = serializeMessage(tx);

  // Serialize signatures
  const signatureCount = tx.signatures.length;
  const signatureBuffer = Buffer.allocUnsafe(1 + signatureCount * 64);
  signatureBuffer.writeUInt8(signatureCount, 0);

  let offset = 1;
  for (const sig of tx.signatures) {
    if (!sig.signature) {
      throw new Error('Transaction must be fully signed');
    }
    signatureBuffer.set(sig.signature, offset);
    offset += 64;
  }

  // Combine signatures + message
  const transactionBuffer = Buffer.concat([signatureBuffer, message] as any);

  // Return base64 encoded
  return transactionBuffer.toString('base64');
}

/**
 * Serialize message (transaction without signatures)
 */
function serializeMessage(tx: Transaction): Buffer {
  if (!tx.recentBlockhash) {
    throw new Error('Transaction must have a recent blockhash');
  }

  // Header: numRequiredSignatures (1) + numReadonlySignedAccounts (1) + numReadonlyUnsignedAccounts (1)
  const header = Buffer.allocUnsafe(3);
  
  // Collect all unique account keys
  const accountKeys = new Map<string, { pubkey: Uint8Array; isSigner: boolean; isWritable: boolean }>();
  
  // Add fee payer first if set
  if (tx.feePayer) {
    const feePayerKey = publicKeyToBase58(tx.feePayer);
    accountKeys.set(feePayerKey, {
      pubkey: tx.feePayer,
      isSigner: true,
      isWritable: true
    });
  }

  // Add signers from signatures
  for (const sig of tx.signatures) {
    const key = publicKeyToBase58(sig.publicKey);
    if (!accountKeys.has(key)) {
      accountKeys.set(key, {
        pubkey: sig.publicKey,
        isSigner: true,
        isWritable: true
      });
    }
  }

  // Add accounts from instructions
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      const keyStr = publicKeyToBase58(key.pubkey);
      if (!accountKeys.has(keyStr)) {
        accountKeys.set(keyStr, {
          pubkey: key.pubkey,
          isSigner: key.isSigner,
          isWritable: key.isWritable
        });
      } else {
        // Update flags if more permissive
        const existing = accountKeys.get(keyStr)!;
        existing.isSigner = existing.isSigner || key.isSigner;
        existing.isWritable = existing.isWritable || key.isWritable;
      }
    }
  }

  // Separate signers and non-signers, writable and readonly
  const signers: Uint8Array[] = [];
  const readonlySigners: Uint8Array[] = [];
  const writableNonSigners: Uint8Array[] = [];
  const readonlyNonSigners: Uint8Array[] = [];

  for (const [_, account] of accountKeys) {
    if (account.isSigner) {
      if (account.isWritable) {
        signers.push(account.pubkey);
      } else {
        readonlySigners.push(account.pubkey);
      }
    } else {
      if (account.isWritable) {
        writableNonSigners.push(account.pubkey);
      } else {
        readonlyNonSigners.push(account.pubkey);
      }
    }
  }

  // Build account array in order: signers (writable), signers (readonly), non-signers (writable), non-signers (readonly)
  const orderedAccounts = [
    ...signers,
    ...readonlySigners,
    ...writableNonSigners,
    ...readonlyNonSigners
  ];

  // Build account indices map
  const accountIndices = new Map<string, number>();
  orderedAccounts.forEach((pubkey, index) => {
    accountIndices.set(publicKeyToBase58(pubkey), index);
  });

  // Header
  const numRequiredSignatures = signers.length + readonlySigners.length;
  const numReadonlySignedAccounts = readonlySigners.length;
  const numReadonlyUnsignedAccounts = readonlyNonSigners.length;

  header.writeUInt8(numRequiredSignatures, 0);
  header.writeUInt8(numReadonlySignedAccounts, 1);
  header.writeUInt8(numReadonlyUnsignedAccounts, 2);

  // Account addresses (32 bytes each)
  const accountAddressBuffers = orderedAccounts.map(pk => {
    if (pk instanceof Buffer) {
      return pk;
    }
    // Convert Uint8Array to Buffer
    return Buffer.from(pk.buffer, pk.byteOffset, pk.byteLength);
  });
  const accountAddresses = Buffer.concat(accountAddressBuffers as any);

  // Recent blockhash (32 bytes)
  const blockhashBuffer = Buffer.from(bs58.decode(tx.recentBlockhash));

  // Instructions
  const instructionCount = Buffer.allocUnsafe(1);
  instructionCount.writeUInt8(tx.instructions.length, 0);

  const instructionBuffers: Buffer[] = [];
  for (const ix of tx.instructions) {
    // Program ID index
    const programIdIndex = accountIndices.get(publicKeyToBase58(ix.programId));
    if (programIdIndex === undefined) {
      throw new Error('Program ID not found in account list');
    }

    // Account indices
    const accountIndicesBuffer = Buffer.allocUnsafe(1 + ix.keys.length);
    accountIndicesBuffer.writeUInt8(ix.keys.length, 0);
    ix.keys.forEach((key, i) => {
      const idx = accountIndices.get(publicKeyToBase58(key.pubkey));
      if (idx === undefined) {
        throw new Error('Account key not found in account list');
      }
      accountIndicesBuffer.writeUInt8(idx, 1 + i);
    });

    // Instruction data length
    const dataLength = Buffer.allocUnsafe(2);
    dataLength.writeUInt16LE(ix.data.length, 0);

    // Instruction data - convert Uint8Array to Buffer
    const dataBuffer = ix.data instanceof Buffer 
      ? ix.data 
      : Buffer.from(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);

    // Combine instruction parts
    instructionBuffers.push(
      Buffer.concat([
        Buffer.from([programIdIndex]),
        accountIndicesBuffer,
        dataLength,
        dataBuffer
      ] as any)
    );
  }

  const instructionsBuffer = Buffer.concat(instructionBuffers as any);

  // Combine all parts
  const allParts: Buffer[] = [
    header,
    accountAddresses,
    blockhashBuffer,
    instructionCount,
    instructionsBuffer
  ];
  return Buffer.concat(allParts as any);
}

