import { ETHERSCAN_BASE, PAIR_ADDRESS, TOKEN_A, TOKEN_B } from "../config/veilswap";

/** Disconnected-state explainer: what happens to a trade inside VeilSwap. */
export function HowItWorksPanel() {
  return (
    <div className="panel">
      <h2>How a trade disappears</h2>
      <ol className="steps-list">
        <li>
          <strong>Deposit once, publicly.</strong> Your {TOKEN_A.symbol}/{TOKEN_B.symbol} becomes an
          encrypted balance — the last thing the chain ever sees you do.
        </li>
        <li>
          <strong>Trade invisibly.</strong> Intents carry encrypted direction, size and limit. Each
          epoch, opposing flow is matched inside the TEE; netted volume never touches the market.
        </li>
        <li>
          <strong>One aggregate swap.</strong> Only the net residual executes on public Uniswap V3,
          from the pool contract — no user addresses, no individual amounts, ever.
        </li>
        <li>
          <strong>Exit anywhere.</strong> Withdraw to a fresh address and the deposit → withdrawal
          trail is severed.
        </li>
      </ol>
      <div className="test-funds">
        <span className="stat-label">test funds for judges</span>
        <p className="dim">
          Grab Sepolia ETH from any{" "}
          <a className="etherscan-link" href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noreferrer">
            faucet ↗
          </a>
          , then wrap it to WETH right inside the Deposit panel. Your first WETH→USDC fill gives you
          USDC to trade the other direction.
        </p>
        <a
          className="etherscan-link"
          href={`${ETHERSCAN_BASE}/address/${PAIR_ADDRESS}#code`}
          target="_blank"
          rel="noreferrer"
        >
          verified contract on Etherscan ↗
        </a>
      </div>
    </div>
  );
}
