import { useAccount } from "wagmi";
import { AppHeader } from "./components/app-header";
import { EpochDashboard } from "./components/epoch-dashboard";
import { BalancesPanel } from "./components/balances-panel";
import { DepositPanel } from "./components/deposit-panel";
import { IntentPanel } from "./components/intent-panel";
import { TransferPanel } from "./components/transfer-panel";
import { WithdrawPanel } from "./components/withdraw-panel";
import { HowItWorksPanel } from "./components/how-it-works-panel";
import { ObserverLedger } from "./components/observer-ledger";
import { VeilBanner } from "./veil/veil-toggle";
import { useVeil } from "./veil/veil-context";
import { PAIR_ADDRESS } from "./config/veilswap";

export default function App() {
  const { isConnected } = useAccount();
  const { chainView } = useVeil();

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
    <div className={`shell${chainView ? " chain-view" : ""}`}>
      <AppHeader />
      <VeilBanner />
      <main className="layout">
        <section className="column">
          <EpochDashboard />
          {isConnected ? <IntentPanel /> : <ConnectHint />}
        </section>
        <section className="column">
          {/* In chain view the observer's ledger leads: it is the whole argument,
              and unlike the wallet panels it needs no connection to be damning. */}
          {chainView && <ObserverLedger />}
          {isConnected ? (
            <>
              <BalancesPanel />
              <DepositPanel />
              <TransferPanel />
              <WithdrawPanel />
            </>
          ) : (
            !chainView && <HowItWorksPanel />
          )}
        </section>
      </main>
      <footer className="footer">
        <span>
          balances · direction · size · limit — all encrypted Nox handles
        </span>
        <span>one aggregate swap per epoch · ownerless · permissionless settlement</span>
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
