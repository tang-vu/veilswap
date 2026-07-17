import { usePublicClient, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";
import deployments from "../config/deployments.json";
import { ETHERSCAN_BASE, PAIR_ABI, PAIR_ADDRESS, TOKEN_A, TOKEN_B } from "../config/veilswap";
import { formatToken } from "../lib/format";
import { NettingDiagram } from "./netting-diagram";

type Settlement = readonly [bigint, bigint, boolean, bigint, bigint];

/** Walks back through recent epochs to surface the latest settlement that
 *  actually moved volume (empty rolls are skipped so the money shot — the
 *  single aggregate swap — stays visible to visitors). */
export function LatestActiveSettlement({ currentEpochId }: { currentEpochId: bigint }) {
  const publicClient = usePublicClient();
  const { data: activeEpochId } = useQuery({
    queryKey: ["latest-active-settlement", currentEpochId.toString()],
    enabled: !!publicClient,
    refetchInterval: 15000,
    queryFn: async () => {
      const lookback = 20n;
      const first = currentEpochId > lookback ? currentEpochId - lookback : 1n;
      for (let id = currentEpochId - 1n; id >= first; id--) {
        const [sumAIn, sumBIn] = (await publicClient!.readContract({
          address: PAIR_ADDRESS,
          abi: PAIR_ABI,
          functionName: "epochSettlement",
          args: [id],
        })) as Settlement;
        if (sumAIn > 0n || sumBIn > 0n) return id.toString();
      }
      return null;
    },
  });
  if (!activeEpochId) return null;
  return <LastSettlement epochId={BigInt(activeEpochId)} />;
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
  const [sumAIn, sumBIn, sellAResidual, residualIn, uniswapOut] = settlement as Settlement;
  if (sumAIn === 0n && sumBIn === 0n && residualIn === 0n) return null;

  const batched = `${formatToken(sumAIn, TOKEN_A)} ${TOKEN_A.symbol} ⇄ ${formatToken(sumBIn, TOKEN_B)} ${TOKEN_B.symbol}`;

  return (
    <>
      <NettingDiagram
        sumAIn={sumAIn}
        sumBIn={sumBIn}
        sellAResidual={sellAResidual}
        residualIn={residualIn}
        uniswapOut={uniswapOut}
        tokenA={TOKEN_A}
        tokenB={TOKEN_B}
      />
      <div className="settlement">
        <span className="label">last settlement — epoch #{epochId.toString()}</span>
        <p>
          Batched <strong>{batched}</strong>. These side totals are the only trade data the epoch
          ever reveals — never who, never which side, never any individual size.
        </p>
        {txHash && (
          <a className="link" href={`${ETHERSCAN_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer">
            view the single aggregate swap on Etherscan ↗
          </a>
        )}
      </div>
    </>
  );
}
