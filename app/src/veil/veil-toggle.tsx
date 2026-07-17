import { useVeil, type VeilView } from "./veil-context";

const OPTIONS: { view: VeilView; label: string; hint: string }[] = [
  { view: "yours", label: "your view", hint: "Values you hold the key to" },
  { view: "chain", label: "chain view", hint: "Exactly what an observer can read on Sepolia" },
];

/** The demo's centrepiece: flip between your plaintext and the observer's. */
export function VeilToggle() {
  const { view, setView } = useVeil();

  return (
    <div className="veil-toggle" role="group" aria-label="Reality toggle">
      {OPTIONS.map((option) => (
        <button
          key={option.view}
          type="button"
          data-view={option.view}
          title={option.hint}
          aria-pressed={view === option.view}
          className={`veil-segment${view === option.view ? " active" : ""}`}
          onClick={() => setView(option.view)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Explains the switched-on state so the ciphertext never reads as a glitch. */
export function VeilBanner() {
  const { chainView } = useVeil();
  if (!chainView) return null;
  return (
    <div className="veil-banner">
      <span>◈</span>
      <span>
        chain view — every byte a Sepolia observer can read. Encrypted fields show their real Nox
        handle; anything still legible below is leakage the protocol admits to.
      </span>
    </div>
  );
}
