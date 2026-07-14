import { ConnectButton } from "@rainbow-me/rainbowkit";

export function AppHeader() {
  return (
    <header className="header">
      <div className="brand">
        <svg viewBox="0 0 64 64" className="brand-mark" aria-hidden>
          <path
            d="M14 18 L32 50 L50 18"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M22 18 L32 36 L42 18"
            fill="none"
            stroke="var(--accent-2)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        </svg>
        <div>
          <h1>VeilSwap</h1>
          <p className="tagline">encrypted intents · internal netting · one public swap per epoch</p>
        </div>
      </div>
      <ConnectButton showBalance={false} accountStatus="address" chainStatus="icon" />
    </header>
  );
}
