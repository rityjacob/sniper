const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 10_000;

const seen = new Map<string, number>();

/**
 * Records a signature and returns true the first time it is seen within the TTL.
 * Helius may deliver the same webhook more than once; this keeps us from buying twice.
 */
export function markIfNew(signature: string, now = Date.now()): boolean {
  const seenAt = seen.get(signature);
  if (seenAt !== undefined && now - seenAt < TTL_MS) return false;

  seen.set(signature, now);
  if (seen.size > MAX_ENTRIES) prune(now);
  return true;
}

function prune(now: number): void {
  for (const [sig, ts] of seen) {
    if (now - ts >= TTL_MS || seen.size > MAX_ENTRIES) seen.delete(sig);
    else break; // Map iterates in insertion order, so the rest are newer.
  }
}

export function resetDedupe(): void {
  seen.clear();
}
