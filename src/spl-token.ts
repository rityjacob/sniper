/**
 * SPL Token utilities - Manual implementation without SDK
 */

import { Instruction, AccountMeta } from './transaction-builder';
import { findProgramAddress, base58ToPubkey, pubkeyToBase58 } from './crypto-utils';
import bs58 from 'bs58';
import { rpcClient } from './rpc-client';

const TOKEN_PROGRAM_ID = bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = bs58.decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = bs58.decode('11111111111111111111111111111111');

/**
 * Get Associated Token Account address for a mint and owner
 */
export async function getAssociatedTokenAddress(
  mint: Uint8Array,
  owner: Uint8Array
): Promise<Uint8Array> {
  const [address] = await findProgramAddress(
    [
      owner,
      TOKEN_PROGRAM_ID,
      mint
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

/**
 * Create instruction to create an Associated Token Account
 */
export function createAssociatedTokenAccountInstruction(
  payer: Uint8Array,
  associatedToken: Uint8Array,
  owner: Uint8Array,
  mint: Uint8Array
): Instruction {
  // Instruction discriminator: 1 (create)
  const data = Buffer.allocUnsafe(1);
  data.writeUInt8(1, 0);

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  ];

  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys,
    data: new Uint8Array(data)
  };
}

/**
 * Check if an Associated Token Account exists
 */
export async function accountExists(pubkey: Uint8Array): Promise<boolean> {
  try {
    const accountInfo = await rpcClient.getAccountInfo(pubkeyToBase58(pubkey));
    return accountInfo !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Get or create Associated Token Account
 * Returns the ATA address and instructions needed to create it (if needed)
 */
export async function getOrCreateAssociatedTokenAccount(
  mint: Uint8Array,
  owner: Uint8Array,
  payer: Uint8Array
): Promise<{ address: Uint8Array; createInstruction?: Instruction }> {
  const ataAddress = await getAssociatedTokenAddress(mint, owner);
  const exists = await accountExists(ataAddress);

  if (exists) {
    return { address: ataAddress };
  }

  const createInstruction = createAssociatedTokenAccountInstruction(
    payer,
    ataAddress,
    owner,
    mint
  );

  return {
    address: ataAddress,
    createInstruction
  };
}

