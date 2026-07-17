import type { TokenInfo } from "../config/veilswap";
import { formatToken } from "../lib/format";

type Props = {
  sumAIn: bigint;
  sumBIn: bigint;
  sellAResidual: boolean;
  residualIn: bigint;
  uniswapOut: bigint;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
};

/** Percentage of the residual side's flow that was matched inside the pool and
 *  therefore never reached the public market. */
function internalPercent(residualSideTotal: bigint, residualIn: bigint): number {
  if (residualSideTotal === 0n) return 100;
  const matched = residualSideTotal - residualIn;
  return Number((matched * 1000n) / residualSideTotal) / 10;
}

/**
 * The protocol in one picture: two encrypted flows enter the veil, opposing
 * volume recirculates internally, and at most one residual leg escapes to the
 * public Uniswap pool. Geometry is fixed; the data decides what lights up.
 */
export function NettingDiagram({
  sumAIn,
  sumBIn,
  sellAResidual,
  residualIn,
  uniswapOut,
  tokenA,
  tokenB,
}: Props) {
  const fullyNetted = residualIn === 0n;
  const inToken = sellAResidual ? tokenA : tokenB;
  const outToken = sellAResidual ? tokenB : tokenA;
  const residualSideTotal = sellAResidual ? sumAIn : sumBIn;
  const pct = internalPercent(residualSideTotal, residualIn);

  return (
    <div className="netting">
      <svg className="netting-svg" viewBox="0 0 620 180" role="img" aria-label="Epoch netting flow">
        <defs>
          <linearGradient id="veilGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(154,139,255,0)" />
            <stop offset="45%" stopColor="rgba(154,139,255,0.13)" />
            <stop offset="100%" stopColor="rgba(154,139,255,0.03)" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--revealed)" strokeWidth="1.6" />
          </marker>
        </defs>

        {/* the confidential zone — everything inside is ciphertext */}
        <rect
          className="veil-band"
          x="2"
          y="16"
          width="402"
          height="150"
          rx="14"
          stroke="var(--encrypted-line)"
          strokeDasharray="4 5"
          strokeWidth="1"
        />
        <text className="zone-label start" x="4" y="9">
          inside the veil · TDX enclave
        </text>
        <text className="zone-label end" x="616" y="9">
          public chain
        </text>

        {/* encrypted inbound flows */}
        <SourceNode y={61} label={tokenA.symbol} sub="encrypted intent" />
        <SourceNode y={121} label={tokenB.symbol} sub="encrypted intent" />
        <path className="flow-track" d="M104,61 C170,61 190,91 256,91" />
        <path className="flow-track" d="M104,121 C170,121 190,91 256,91" />
        <path className="flow-live flow-in" d="M104,61 C170,61 190,91 256,91" />
        <path className="flow-live flow-in" d="M104,121 C170,121 190,91 256,91" />

        {/* the netting rotor: matched volume recirculating, never leaving */}
        <circle className="flow-track" cx="300" cy="91" r="44" />
        <circle className="flow-live flow-internal" cx="300" cy="91" r="44" />
        <rect className="node-box encrypted" x="266" y="75" width="68" height="32" rx="7" />
        <text className="node-text" x="300" y="91">
          NET
        </text>
        <text className="edge-label internal" x="300" y="152">
          {pct}% netted internally · never on-chain
        </text>

        {/* the single public leg — dark when the epoch nets out completely */}
        <path className="flow-track" d="M344,91 L508,91" markerEnd={fullyNetted ? undefined : "url(#arrow)"} />
        {!fullyNetted && <path className="flow-live flow-residual" d="M344,91 L508,91" />}
        <text className={`edge-label ${fullyNetted ? "hidden-label" : "internal"}`} x="426" y="78">
          {fullyNetted ? "no public swap" : `residual ${formatToken(residualIn, inToken)} ${inToken.symbol}`}
        </text>

        <rect
          className={`node-box ${fullyNetted ? "" : "public"}`}
          x="512"
          y="73"
          width="104"
          height="36"
          rx="8"
        />
        <text className="node-text" x="564" y="86">
          UNISWAP V3
        </text>
        <text className="node-sub" x="564" y="99">
          {fullyNetted ? "untouched" : `+${formatToken(uniswapOut, outToken)} ${outToken.symbol}`}
        </text>
      </svg>

      <p className="netting-caption">
        {fullyNetted ? (
          <>
            this epoch settled with <strong>zero public swaps</strong> — the market never saw it
          </>
        ) : (
          <>
            the market saw <strong>one aggregate swap</strong> — no addresses, no individual sizes
          </>
        )}
      </p>
    </div>
  );
}

function SourceNode({ y, label, sub }: { y: number; label: string; sub: string }) {
  return (
    <>
      <rect className="node-box encrypted" x="16" y={y - 17} width="88" height="34" rx="7" />
      <text className="node-text" x="60" y={y - 5}>
        {label}
      </text>
      <text className="node-sub" x="60" y={y + 7}>
        {sub}
      </text>
    </>
  );
}
