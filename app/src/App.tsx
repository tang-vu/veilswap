import { useAccount } from "wagmi";
import { AppHeader } from "./components/app-header";
import { EpochDashboard } from "./components/epoch-dashboard";
import { BalancesPanel } from "./components/balances-panel";
import { DepositPanel } from "./components/deposit-panel";
import { IntentPanel } from "./components/intent-panel";
import { TransferPanel } from "./components/transfer-panel";
import { WithdrawPanel } from "./components/withdraw-panel";
import { PAIR_ADDRESS } from "./config/veilswap";

export default function App() {
  const { isConnected } = useAccount();

  if (!PAIR_ADDRESS) {
    return (
      <div className="shell">
        <AppHeader />
        <main className="empty-state">
          <p>
            VeilSwapPair address is not configured. Deploy the contracts and run
            <code> pnpm tsx scripts/export-abi-to-app.ts</code>, or set
            <code> VITE_VEILSWAP_PAIR_ADDRESS</code>.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <AppHeader />
      <main className="layout">
        <section className="column">
          <EpochDashboard />
          {isConnected ? <IntentPanel /> : <ConnectHint />}
        </section>
        <section className="column">
          {isConnected && (
            <>
              <BalancesPanel />
              <DepositPanel />
              <TransferPanel />
              <WithdrawPanel />
            </>
          )}
        </section>
      </main>
      <footer className="footer">
        <span>
          Every balance, direction, size and limit below is an encrypted Nox handle — the chain
          only ever sees one aggregate swap per epoch.
        </span>
      </footer>
    </div>
  );
}

function ConnectHint() {
  return (
    <div className="panel hint-panel">
      <h2>Enter the dark pool</h2>
      <p>
        Connect a Sepolia wallet to deposit, submit encrypted swap intents, transfer privately and
        withdraw to any address.
      </p>
    </div>
  );
}
