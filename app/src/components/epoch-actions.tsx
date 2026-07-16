import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { PAIR_ABI, PAIR_ADDRESS } from "../config/veilswap";
import { getHandleClient, publicDecryptWhenReady } from "../lib/nox-client";
import { usePairWrite } from "../hooks/use-pair-write";

/**
 * The dashboard doubles as a keeper: locking and settling are permissionless,
 * the reference price comes from the pool itself, and the decryption proofs
 * are fetched from the Nox gateway right here in the browser and verified
 * on-chain. Any visitor can drive the protocol forward.
 */
export function EpochActions({
  epochId,
  phase,
  deadline,
  intentCount,
  maxIntents,
  now,
}: {
  epochId: bigint;
  phase: number;
  deadline: bigint;
  intentCount: bigint;
  maxIntents: number;
  now: number;
}) {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { write, status, error } = usePairWrite();
  const [settleStage, setSettleStage] = useState<"idle" | "proofs" | "tx">("idle");

  const lockable = phase === 1 && (BigInt(now) >= deadline || (maxIntents > 0 && intentCount >= BigInt(maxIntents)));
  const settleable = phase === 2;
  if (!lockable && !settleable) return null;

  async function lock() {
    await write("lockEpoch", []);
  }

  async function settle() {
    if (!walletClient || !publicClient) return;
    try {
      setSettleStage("proofs");
      const [sumAHandle, sumBHandle] = (await publicClient.readContract({
        address: PAIR_ADDRESS,
        abi: PAIR_ABI,
        functionName: "epochSumHandles",
        args: [epochId],
      })) as readonly [`0x${string}`, `0x${string}`];
      const client = await getHandleClient(walletClient);
      const [proofA, proofB] = await Promise.all([
        publicDecryptWhenReady(client, sumAHandle),
        publicDecryptWhenReady(client, sumBHandle),
      ]);
      setSettleStage("tx");
      await write("settleEpoch", [proofA.decryptionProof, proofB.decryptionProof]);
    } finally {
      setSettleStage("idle");
    }
  }

  const busy = status === "wallet" || status === "pending" || settleStage !== "idle";

  return (
    <div className="epoch-actions">
      {!isConnected ? (
        <span className="dim">
          epoch #{epochId.toString()} is ready to {lockable ? "lock" : "settle"} — connect any wallet to
          drive it (settlement is permissionless)
        </span>
      ) : lockable ? (
        <button className="btn btn-primary" onClick={lock} disabled={busy}>
          {busy
            ? "locking…"
            : intentCount === 0n
              ? "roll empty epoch forward"
              : `lock epoch #${epochId.toString()} (${intentCount.toString()} encrypted intents)`}
        </button>
      ) : (
        <button className="btn btn-primary" onClick={settle} disabled={busy}>
          {settleStage === "proofs"
            ? "fetching TEE decryption proofs…"
            : settleStage === "tx" || busy
              ? "settling on-chain…"
              : "finalize settlement (fetch proofs + one aggregate swap)"}
        </button>
      )}
      {(lockable || settleable) && isConnected && (
        <span className="dim keeper-caption">
          you are acting as the keeper — no operator, no admin keys, proofs verified on-chain
        </span>
      )}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
