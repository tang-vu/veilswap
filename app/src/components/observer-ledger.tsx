import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, type Log } from "viem";
import deployments from "../config/deployments.json";
import { PAIR_ABI, PAIR_ADDRESS, TOKEN_A, TOKEN_B } from "../config/veilswap";
import { formatToken, shortAddress } from "../lib/format";
import { CipherText } from "../veil/veiled-value";

type Row = {
  event: string;
  detail: string;
  /** What the chain gives away here, versus what stays sealed. */
  note: string;
  sealed: boolean;
  handle?: string;
};

const tokenOf = (address: unknown) =>
  String(address).toLowerCase() === TOKEN_A.address.toLowerCase() ? TOKEN_A : TOKEN_B;

/** Turns a raw log into the line an indexer would actually be able to write. */
function describe(name: string, args: Record<string, unknown>): Row | null {
  switch (name) {
    case "IntentSubmitted":
      return {
        event: "IntentSubmitted",
        detail: `epoch ${args.epochId} · idx ${args.index} · ${shortAddress(String(args.owner))}`,
        note: "direction, size and limit — all sealed",
        sealed: true,
      };
    case "ConfidentialTransfer":
      return {
        event: "ConfidentialTransfer",
        detail: `${shortAddress(String(args.from))} → ${shortAddress(String(args.to))} · ${tokenOf(args.token).symbol}`,
        note: "amount — sealed",
        sealed: true,
      };
    case "EpochLocked":
      // Empty rolls carry no information; an indexer would ignore them too.
      if ((args.intentCount as bigint) === 0n) return null;
      return {
        event: "EpochLocked",
        detail: `epoch ${args.epochId} · ${args.intentCount} intents`,
        note: "side totals emitted as ciphertext handles",
        sealed: true,
        handle: String(args.sumAIn),
      };
    case "Deposited": {
      const token = tokenOf(args.token);
      return {
        event: "Deposited",
        detail: `${shortAddress(String(args.user))} · ${formatToken(args.amount as bigint, token)} ${token.symbol}`,
        note: "amount is public — documented leakage",
        sealed: false,
      };
    }
    case "EpochSettled": {
      const sumA = args.sumAIn as bigint;
      const sumB = args.sumBIn as bigint;
      if (sumA === 0n && sumB === 0n) return null; // empty roll — no volume, no signal
      return {
        event: "EpochSettled",
        detail: `epoch ${args.epochId} · ${formatToken(sumA, TOKEN_A)} ${TOKEN_A.symbol} ⇄ ${formatToken(sumB, TOKEN_B)} ${TOKEN_B.symbol}`,
        note: "side totals only — never per-user",
        sealed: false,
      };
    }
    case "WithdrawFinalized": {
      const token = tokenOf(args.token);
      return {
        event: "WithdrawFinalized",
        detail: `${shortAddress(String(args.to))} · ${formatToken(args.amount as bigint, token)} ${token.symbol}`,
        note: "exit address unlinkable to any deposit",
        sealed: false,
      };
    }
    default:
      return null;
  }
}

/**
 * Every byte VeilSwap has ever leaked to Sepolia, decoded from the real event
 * log. No wallet required — this is precisely an indexer's view, which is why
 * the interesting fields are missing rather than hidden by this UI.
 */
export function ObserverLedger() {
  const publicClient = usePublicClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["observer-ledger"],
    enabled: !!publicClient,
    refetchInterval: 20000,
    queryFn: async () => {
      const logs = await publicClient!.getLogs({
        address: PAIR_ADDRESS,
        fromBlock: BigInt(deployments.deployedAtBlock || 0),
      });
      const out: Row[] = [];
      // Newest first, and scan the whole history: the keeper's empty rolls are
      // filtered out above, so the real activity can be far back in the log.
      for (const log of [...logs].reverse()) {
        try {
          const { eventName, args } = decodeEventLog({
            abi: PAIR_ABI,
            data: (log as Log).data,
            topics: (log as Log).topics,
          });
          const row = describe(eventName as string, (args ?? {}) as Record<string, unknown>);
          if (row) out.push(row);
        } catch {
          // unknown/legacy topic — an indexer would skip it too
        }
        if (out.length >= 7) break;
      }
      return out;
    },
  });

  return (
    <div className="panel">
      <h2>Observer&apos;s ledger</h2>
      <p className="dim" style={{ margin: 0, fontSize: 13 }}>
        The pool&apos;s recent activity, decoded from Sepolia&apos;s real event log — no wallet, no
        privileges. Nothing here is redacted by this app: the missing fields simply do not exist
        on-chain.
      </p>

      {isLoading && <span className="label">reading the chain…</span>}
      {rows?.length === 0 && <span className="label">no activity in this deployment yet</span>}

      <div className="ledger">
        {rows?.map((row, i) => (
          <div className={`ledger-row${row.sealed ? " sealed" : ""}`} key={i}>
            <span className="ledger-event">{row.event}</span>
            <span className="ledger-detail mono">
              {row.detail}
              {row.handle && (
                <>
                  {" · "}
                  <CipherText handle={row.handle} />
                </>
              )}
            </span>
            <span className={`ledger-note${row.sealed ? " sealed" : ""}`}>
              {row.sealed ? "◈ " : "○ "}
              {row.note}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
