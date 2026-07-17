import type { ReactNode } from "react";
import { shortHandle } from "../lib/format";
import { useVeil } from "./veil-context";
import { useCipherShimmer } from "./use-cipher-shimmer";

/** Renders a real Nox handle as living ciphertext. The title attribute carries
 *  the full 32 bytes so anyone can copy it and check it against the chain. */
export function CipherText({ handle, short = true }: { handle: string; short?: boolean }) {
  const display = short ? shortHandle(handle) : handle;
  const { text, hotIndex } = useCipherShimmer(display, true);

  return (
    <span className="cipher" title={`Nox handle ${handle} — ciphertext, unreadable on-chain`}>
      {hotIndex < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, hotIndex)}
          <span className="cipher-hot">{text[hotIndex]}</span>
          {text.slice(hotIndex + 1)}
        </>
      )}
    </span>
  );
}

/**
 * Shows `children` normally, but swaps in the value's on-chain ciphertext while
 * the user is in chain view. Only wrap values that genuinely are encrypted —
 * public leakage must stay readable or the toggle stops being a threat model.
 */
export function Veiled({ handle, children }: { handle?: string; children: ReactNode }) {
  const { chainView } = useVeil();
  if (chainView && handle) return <CipherText handle={handle} />;
  return <>{children}</>;
}

/** For encrypted fields whose handle this view does not fetch: blocks, never a
 *  fabricated handle, so nothing on screen pretends to be chain data. */
export function Redacted({ children, width = 8 }: { children: ReactNode; width?: number }) {
  const { chainView } = useVeil();
  if (!chainView) return <>{children}</>;
  return (
    <span className="cipher" title="Encrypted — the chain stores a handle, not this value">
      {"█".repeat(width)}
    </span>
  );
}
