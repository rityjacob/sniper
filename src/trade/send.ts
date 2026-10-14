import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

// Pump buys use ~70k CU (incl. creating our token account); leave headroom.
const COMPUTE_UNIT_LIMIT = 150_000;

export function computeBudgetInstructions(priorityFeeLamports: number): TransactionInstruction[] {
  // The priority fee is charged on the requested limit, not on CU used,
  // so this makes the total priority fee exactly priorityFeeLamports.
  const microLamports = Math.floor((priorityFeeLamports * 1_000_000) / COMPUTE_UNIT_LIMIT);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

export async function buildLegacyTransaction(
  instructions: TransactionInstruction[],
  wallet: Keypair,
  blockhash: Promise<{ blockhash: string }>
): Promise<Transaction> {
  const tx = new Transaction().add(...instructions);
  tx.recentBlockhash = (await blockhash).blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);
  return tx;
}

/**
 * Sends a signed transaction without preflight (saves a round-trip) and confirms
 * it in the background. With dryRun it only simulates and logs the result.
 */
export async function sendSigned(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
  label: string,
  dryRun: boolean
): Promise<string> {
  if (dryRun) {
    const sim =
      tx instanceof VersionedTransaction
        ? await connection.simulateTransaction(tx)
        : await connection.simulateTransaction(tx);
    console.log(`${label} DRY_RUN simulation`, {
      err: sim.value.err,
      unitsConsumed: sim.value.unitsConsumed,
      logs: sim.value.logs?.slice(-10),
    });
    return "dry-run";
  }

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 2,
  });
  console.log(`${label} sent:`, signature);
  void confirmInBackground(connection, signature, label);
  return signature;
}

async function confirmInBackground(
  connection: Connection,
  signature: string,
  label: string
): Promise<void> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { value } = await connection.getSignatureStatus(signature);
      // Check the error first: a confirmed transaction can still have failed.
      if (value?.err) {
        console.error(`${label} failed on-chain:`, signature, JSON.stringify(value.err));
        return;
      }
      if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
        console.log(`${label} confirmed:`, signature);
        return;
      }
    } catch (err) {
      console.warn(`${label} status check failed:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`${label} not confirmed after ${maxAttempts}s (may have been dropped):`, signature);
}
