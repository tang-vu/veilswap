import { useMemo, useState } from "react";
import { useReadContract, useWalletClient } from "wagmi";
import { PAIR_ADDRESS, PAIR_ABI, POOL_ABI, POOL_ADDRESS, TOKEN_A, TOKEN_B } from "../config/veilswap";
import { formatToken, parseToken, spotPricesE18 } from "../lib/format";
import { getHandleClient } from "../lib/nox-client";
import { usePairWrite } from "../hooks/use-pair-write";

type Step = "idle" | "encrypting" | "submitting";

/**
 * Fully encrypted swap intent: direction, size AND limit are handles. The only
 * on-chain trace of this form is "an intent was submitted to epoch #N".
 */
export function IntentPanel() {
  const { data: walletClient } = useWalletClient();
  const [sellAForB, setSellAForB] = useState(true);
  const [amount, setAmount] = useState("");
  const [minOut, setMinOut] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [submittedEpoch, setSubmittedEpoch] = useState<bigint | null>(null);
  const { write, error, status } = usePairWrite();

  const tokenIn = sellAForB ? TOKEN_A : TOKEN_B;
  const tokenOut = sellAForB ? TOKEN_B : TOKEN_A;

  const { data: epochId } = useReadContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: "currentEpochId",
    query: { refetchInterval: 5000 },
  });

  const { data: slot0 } = useReadContract({
    address: POOL_ADDRESS,
    abi: POOL_ABI,
    functionName: "slot0",
    query: { refetchInterval: 30000 },
  });
  const { data: token0 } = useReadContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "token0" });

  const quote = useMemo(() => {
    if (!slot0 || !token0) return null;
    const aIsToken0 = (token0 as string).toLowerCase() === TOKEN_A.address.toLowerCase();
    const { aToB, bToA } = spotPricesE18(slot0[0] as bigint, aIsToken0);
    return sellAForB ? aToB : bToA;
  }, [slot0, token0, sellAForB]);

  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseToken(amount, tokenIn) : 0n;
    } catch {
      return null;
    }
  }, [amount, tokenIn]);

  // Suggested limit: spot minus 1.5%. The contract guarantees lock-price minus
  // 0.5%; the extra percent absorbs pool drift between quoting and the epoch
  // lock so the intent isn't excluded by a marginal move.
  const suggestedMinOut = useMemo(() => {
    if (!quote || parsedAmount === null || parsedAmount === 0n) return null;
    return (parsedAmount * quote * 9850n) / (10n ** 18n * 10000n);
  }, [quote, parsedAmount]);

  const parsedMinOut = useMemo(() => {
    try {
      return minOut ? parseToken(minOut, tokenOut) : null;
    } catch {
      return null;
    }
  }, [minOut, tokenOut]);

  async function submit() {
    if (!walletClient || parsedAmount === null || parsedAmount === 0n) return;
    const limit = parsedMinOut ?? suggestedMinOut ?? 0n;
    try {
      setStep("encrypting");
      const client = await getHandleClient(walletClient);
      const [dir, amt, min] = await Promise.all([
        client.encryptInput(sellAForB, "bool", PAIR_ADDRESS),
        client.encryptInput(parsedAmount, "uint256", PAIR_ADDRESS),
        client.encryptInput(limit, "uint256", PAIR_ADDRESS),
      ]);
      setStep("submitting");
      await write("submitIntent", [
        dir.handle,
        amt.handle,
        min.handle,
        dir.handleProof,
        amt.handleProof,
        min.handleProof,
      ]);
      setSubmittedEpoch(epochId ?? null);
      setAmount("");
      setMinOut("");
    } finally {
      setStep("idle");
    }
  }

  const busy = step !== "idle";

  return (
    <div className="panel">
      <h2>Swap intent</h2>
      <div className="direction-toggle" role="group" aria-label="direction">
        <button className={`token-option ${sellAForB ? "active" : ""}`} onClick={() => setSellAForB(true)}>
          {TOKEN_A.symbol} → {TOKEN_B.symbol}
        </button>
        <button className={`token-option ${!sellAForB ? "active" : ""}`} onClick={() => setSellAForB(false)}>
          {TOKEN_B.symbol} → {TOKEN_A.symbol}
        </button>
      </div>
      <label className="field-label">amount in ({tokenIn.symbol})</label>
      <input
        className="input mono"
        placeholder="0.0"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        inputMode="decimal"
      />
      <label className="field-label">
        min output ({tokenOut.symbol})
        {suggestedMinOut !== null && (
          <button className="btn-inline" onClick={() => setMinOut(formatToken(suggestedMinOut, tokenOut, tokenOut.decimals))}>
            use suggested {formatToken(suggestedMinOut, tokenOut)}
          </button>
        )}
      </label>
      <input
        className="input mono"
        placeholder={suggestedMinOut !== null ? formatToken(suggestedMinOut, tokenOut) : "0.0"}
        value={minOut}
        onChange={(event) => setMinOut(event.target.value)}
        inputMode="decimal"
      />
      <button
        className="btn btn-primary"
        onClick={submit}
        disabled={busy || parsedAmount === null || parsedAmount === 0n || status === "pending"}
      >
        {step === "encrypting"
          ? "encrypting via TEE gateway…"
          : step === "submitting"
            ? "submitting intent…"
            : "submit encrypted intent"}
      </button>
      {error && <span className="error-text">{error}</span>}
      {submittedEpoch !== null && status === "success" && (
        <div className="pending-chip">
          intent queued in epoch #{submittedEpoch.toString()} — direction, size and limit are encrypted
        </div>
      )}
      <p className="privacy-note">
        If your balance can't cover the amount, the intent is recorded with an encrypted zero —
        nothing on-chain reveals which. Intents whose limit can't be guaranteed at the epoch price
        are excluded and refunded automatically.
      </p>
    </div>
  );
}
