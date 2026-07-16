import { useEffect, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";
import deployments from "../config/deployments.json";
import { ETHERSCAN_BASE, PAIR_ABI, PAIR_ADDRESS, TOKEN_A, TOKEN_B } from "../config/veilswap";
import { formatCountdown, formatToken } from "../lib/format";
import { EpochActions } from "./epoch-actions";

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

  return (
    <div className="panel">
      <div className="panel-title-row">
        <h2>Epoch #{epochId?.toString() ?? "…"}</h2>
        <span className={`phase-chip phase-${PHASE_NAMES[phase] ?? "—"}`}>{PHASE_NAMES[phase] ?? "…"}</span>
      </div>
      <div className="epoch-grid">
        <div className="stat">
          <span className="stat-label">next settlement</span>
          <span className="stat-value mono">{phase === 1 ? formatCountdown(secondsLeft) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">pending intents</span>
          <span className="stat-value mono">
            {intentCount.toString()}
            <span className="dim"> / {maxIntents?.toString() ?? "…"}</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">contents visible on-chain</span>
          <span className="stat-value">none — count only</span>
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
      {epochId !== undefined && epochId > 1n && <LastSettlement epochId={epochId - 1n} />}
    </div>
  );
}

function LastSettlement({ epochId }: { epochId: bigint }) {
  const publicClient = usePublicClient();

  const { data: settlement } = useReadContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: "epochSettlement",
    args: [epochId],
    query: { refetchInterval: 15000 },
  });

  const { data: txHash } = useQuery({
    queryKey: ["settlement-tx", epochId.toString()],
    enabled: !!publicClient,
    refetchInterval: 20000,
    queryFn: async () => {
      const logs = await publicClient!.getLogs({
        address: PAIR_ADDRESS,
        event: parseAbiItem(
          "event EpochSettled(uint64 indexed epochId, uint256 sumAIn, uint256 sumBIn, bool sellAResidual, uint256 residualIn, uint256 uniswapAmountOut)"
        ),
        args: { epochId },
        fromBlock: BigInt(deployments.deployedAtBlock || 0),
      });
      return logs.at(-1)?.transactionHash ?? null;
    },
  });

  if (!settlement) return null;
  const [sumAIn, sumBIn, sellAResidual, residualIn, uniswapOut] = settlement as readonly [
    bigint,
    bigint,
    boolean,
    bigint,
    bigint,
  ];
  if (sumAIn === 0n && sumBIn === 0n && residualIn === 0n) return null;

  const inToken = sellAResidual ? TOKEN_A : TOKEN_B;
  const outToken = sellAResidual ? TOKEN_B : TOKEN_A;
  const batched = `${formatToken(sumAIn, TOKEN_A)} ${TOKEN_A.symbol} ⇄ ${formatToken(sumBIn, TOKEN_B)} ${TOKEN_B.symbol}`;

  return (
    <div className="last-settlement">
      <span className="stat-label">last settlement — epoch #{epochId.toString()}</span>
      <p>
        Batched <strong>{batched}</strong>, netted internally, and executed{" "}
        <strong>
          {residualIn === 0n
            ? "ZERO public swaps (fully netted)"
            : `ONE public swap: ${formatToken(residualIn, inToken)} ${inToken.symbol} → ${formatToken(uniswapOut, outToken)} ${outToken.symbol}`}
        </strong>
        .
      </p>
      {txHash && (
        <a className="etherscan-link" href={`${ETHERSCAN_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer">
          view the single aggregate swap on Etherscan ↗
        </a>
      )}
    </div>
  );
}
