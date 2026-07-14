import { readPair, writePair, type KeeperContext } from "./veilswap-contract-client.js";

/**
 * One idempotent settlement pass. All state is derived from the chain, so the
 * keeper can crash or be re-run at any point and always does the right thing:
 *
 *   Open   + (deadline passed | epoch full)  → lockEpoch()
 *   Locked                                   → publicDecrypt totals → settleEpoch(proofs)
 *   Locked + grace elapsed + settle failing  → cancelEpoch()
 *
 * The keeper holds no authority: every call is permissionless and every input
 * it provides is either read from the pool or carries a Nox decryption proof
 * verified on-chain. It only provides liveness.
 */

const PHASE = { None: 0, Open: 1, Locked: 2, Settled: 3, Cancelled: 4 } as const;

const DECRYPT_MAX_ATTEMPTS = 30;
const DECRYPT_RETRY_MS = 10_000;

export async function runSettlementPass(ctx: KeeperContext): Promise<void> {
  const epochId = await readPair<bigint>(ctx, "currentEpochId");
  const [phase, , deadline, lockedAt, intentCount] = await readPair<
    [number, bigint, bigint, bigint, bigint]
  >(ctx, "epochStatus", [epochId]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  log(`epoch ${epochId} phase=${phaseName(phase)} intents=${intentCount} deadline=${deadline} now=${now}`);

  if (phase === PHASE.Open) {
    const maxIntents = await readPair<number>(ctx, "maxIntentsPerEpoch");
    const lockable = now >= deadline || intentCount >= BigInt(maxIntents);
    if (!lockable) {
      log(`nothing to do: ${deadline - now}s until deadline (${intentCount}/${maxIntents} intents)`);
      return;
    }
    // Locking a 0-intent epoch rolls it forward so the next window opens —
    // required for liveness, since submissions close at the deadline.
    const hash = await writePair(ctx, "lockEpoch");
    log(`lockEpoch: ${hash}`);
    if (intentCount === 0n) return; // rolled empty; fresh epoch is open
    await settleLocked(ctx, epochId);
    return;
  }

  if (phase === PHASE.Locked) {
    const cancelGrace = await readPair<bigint>(ctx, "cancelGracePeriod");
    try {
      await settleLocked(ctx, epochId);
    } catch (error) {
      // Typical cause: pool moved beyond the slippage bound → router reverts.
      // Retry on later passes; after the grace period, free the escrows.
      log(`settle failed: ${(error as Error).message}`);
      if (now > lockedAt + cancelGrace) {
        const hash = await writePair(ctx, "cancelEpoch");
        log(`cancelEpoch (grace elapsed): ${hash}`);
      } else {
        log(`will retry; cancel possible after ${lockedAt + cancelGrace - now}s`);
        throw error;
      }
    }
    return;
  }

  log("epoch already finalized; nothing to do");
}

async function settleLocked(ctx: KeeperContext, epochId: bigint): Promise<void> {
  const [sumAHandle, sumBHandle] = await readPair<[`0x${string}`, `0x${string}`]>(ctx, "epochSumHandles", [
    epochId,
  ]);
  const sumA = await publicDecryptWithRetry(ctx, sumAHandle);
  const sumB = await publicDecryptWithRetry(ctx, sumBHandle);
  log(`decrypted totals: sumAIn=${sumA.value} sumBIn=${sumB.value}`);

  const hash = await writePair(ctx, "settleEpoch", [sumA.decryptionProof, sumB.decryptionProof]);
  log(`settleEpoch: ${hash}`);
}

/** The TEE runner resolves handles asynchronously — poll until decryptable. */
async function publicDecryptWithRetry(
  ctx: KeeperContext,
  handle: `0x${string}`
): Promise<{ value: bigint; decryptionProof: `0x${string}` }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DECRYPT_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await ctx.handleClient.publicDecrypt(handle as any);
      return { value: result.value as bigint, decryptionProof: result.decryptionProof as `0x${string}` };
    } catch (error) {
      lastError = error;
      log(`publicDecrypt(${handle.slice(0, 10)}…) attempt ${attempt}/${DECRYPT_MAX_ATTEMPTS} not ready`);
      await new Promise((resolve) => setTimeout(resolve, DECRYPT_RETRY_MS));
    }
  }
  throw new Error(`publicDecrypt gave up after ${DECRYPT_MAX_ATTEMPTS} attempts: ${String(lastError)}`);
}

function phaseName(phase: number): string {
  return Object.entries(PHASE).find(([, v]) => v === phase)?.[0] ?? `unknown(${phase})`;
}

function log(message: string): void {
  console.log(`[keeper ${new Date().toISOString()}] ${message}`);
}
