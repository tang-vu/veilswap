import { useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { decodeEventLog, isAddress } from "viem";
import { ETHERSCAN_BASE, PAIR_ABI, PAIR_ADDRESS, TOKEN_A } from "../config/veilswap";
import { formatToken, parseToken } from "../lib/format";
import { getHandleClient, publicDecryptWhenReady } from "../lib/nox-client";
import { usePairWrite } from "../hooks/use-pair-write";
import { TokenSelect } from "./token-select";

type Stage = "idle" | "encrypting" | "requesting" | "decrypting" | "finalizing" | "done";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "withdraw",
  encrypting: "encrypting amount…",
  requesting: "requesting withdrawal…",
  decrypting: "waiting for TEE decryption…",
  finalizing: "releasing funds…",
  done: "withdraw again",
};

/**
 * Two-step exit: burn an encrypted amount, then finalize with a public
 * decryption proof verified on-chain. Withdrawing to a FRESH address severs
 * the link between your deposits and your withdrawals.
 */
export function WithdrawPanel() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [token, setToken] = useState(TOKEN_A);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<{ amount: bigint; txHash: `0x${string}` } | null>(null);
  const [error, setError] = useState<string | undefined>();
  const { write } = usePairWrite();

  const parsed = useMemo(() => {
    try {
      return amount ? parseToken(amount, token) : 0n;
    } catch {
      return null;
    }
  }, [amount, token]);

  const target = recipient || address || "";
  const validRecipient = isAddress(target);

  async function withdraw() {
    if (!walletClient || !validRecipient || parsed === null || parsed === 0n) return;
    setError(undefined);
    setResult(null);
    try {
      setStage("encrypting");
      const client = await getHandleClient(walletClient);
      const enc = await client.encryptInput(parsed, "uint256", PAIR_ADDRESS);

      setStage("requesting");
      const receipt = await write("requestWithdraw", [token.address, target, enc.handle, enc.handleProof]);
      const requestId = extractRequestId(receipt.logs);
      if (!requestId) throw new Error("WithdrawRequested event not found");

      setStage("decrypting");
      const { value, decryptionProof } = await publicDecryptWhenReady(client, requestId);
      if (value === 0n) throw new Error("Withdrawn amount is 0 — balance was insufficient (all-or-nothing).");

      setStage("finalizing");
      const finalizeReceipt = await write("finalizeWithdraw", [requestId, decryptionProof]);
      setResult({ amount: value, txHash: finalizeReceipt.transactionHash });
      setStage("done");
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }

  const busy = stage !== "idle" && stage !== "done";

  return (
    <div className="panel">
      <h2>Withdraw</h2>
      <div className="form-row">
        <TokenSelect value={token} onChange={setToken} />
        <input
          className="input mono"
          placeholder="0.0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
        />
      </div>
      <input
        className="input mono"
        placeholder={`recipient (default: your wallet) — use a fresh address to break linkage`}
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
      />
      {recipient && !validRecipient && <span className="error-text">invalid address</span>}
      <button className="btn btn-primary" onClick={withdraw} disabled={busy || !validRecipient || !parsed}>
        {STAGE_TEXT[stage]}
      </button>
      {busy && (
        <div className="stepper">
          {(["requesting", "decrypting", "finalizing"] as Stage[]).map((s) => (
            <span key={s} className={`step ${stage === s ? "active" : ""}`}>
              {s}
            </span>
          ))}
        </div>
      )}
      {result && (
        <a className="link" href={`${ETHERSCAN_BASE}/tx/${result.txHash}`} target="_blank" rel="noreferrer">
          released {formatToken(result.amount, token)} {token.symbol} — view tx ↗
        </a>
      )}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

function extractRequestId(logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[]) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: PAIR_ABI, data: log.data, topics: log.topics as never });
      if (decoded.eventName === "WithdrawRequested") {
        return (decoded.args as { requestId: `0x${string}` }).requestId;
      }
    } catch {
      // not a pair event — skip
    }
  }
  return null;
}
