import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { PAIR_ABI, PAIR_ADDRESS } from "../config/veilswap";
import { formatCountdown } from "../lib/format";
import { EpochActions } from "./epoch-actions";
import { LatestActiveSettlement } from "./epoch-settlement";

const PHASE_NAMES = ["—", "OPEN", "LOCKED", "SETTLED", "CANCELLED"] as const;

/**
 * The money shot: live epoch state (countdown + intent COUNT — never amounts)
 * and the previous epoch's settlement, linking to the ONE aggregate Uniswap
 * swap on Etherscan.
 */
export function EpochDashboard() {
  const { data: epochId } = useReadContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: "currentEpochId",
    query: { refetchInterval: 5000 },
  });

  const { data: status } = useReadContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: "epochStatus",
    args: epochId !== undefined ? [epochId] : undefined,
    query: { enabled: epochId !== undefined, refetchInterval: 5000 },
  });

  const { data: maxIntents } = useReadContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: "maxIntentsPerEpoch",
  });

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const [phase, , deadline, , intentCount] = (status ?? [0, 0n, 0n, 0n, 0n]) as readonly [
    number,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const secondsLeft = Number(deadline) - now;
  const phaseName = PHASE_NAMES[phase] ?? "—";
  const isOpen = phase === 1;
  const urgent = isOpen && secondsLeft <= 30 && secondsLeft > 0;

  return (
    <div className="panel panel-hero">
      <div className="panel-title-row">
        <h2>Epoch #{epochId?.toString() ?? "…"}</h2>
        <span className={`chip chip-dot phase-${phaseName}`}>{phaseName === "—" ? "…" : phaseName}</span>
      </div>

      <div className="epoch-hero">
        <span className={`epoch-countdown${urgent ? " urgent" : ""}`}>
          {isOpen ? formatCountdown(secondsLeft) : "--:--"}
        </span>
        <div className="epoch-meta">
          <span className="label">next settlement</span>
          <span className="mono dim" style={{ fontSize: 12 }}>
            {isOpen ? "batching intents" : "awaiting keeper"}
          </span>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="label">intents in batch</span>
          <span className="stat-value mono">
            {intentCount.toString()}
            <span className="dim"> / {maxIntents?.toString() ?? "…"}</span>
          </span>
        </div>
        <div className="stat">
          <span className="label">your anonymity set</span>
          <span className="stat-value mono">
            {intentCount > 0n ? `1 of ${intentCount.toString()}` : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="label">visible on-chain</span>
          <span className="stat-value sm">count only — no sizes, no sides</span>
        </div>
      </div>

      {epochId !== undefined && (
        <EpochActions
          epochId={epochId}
          phase={phase}
          deadline={deadline}
          intentCount={intentCount}
          maxIntents={Number(maxIntents ?? 0)}
          now={now}
        />
      )}
      {epochId !== undefined && epochId > 1n && <LatestActiveSettlement currentEpochId={epochId} />}
    </div>
  );
}
