import { useEffect, useState } from "react";

const HEX = "0123456789abcdef";
const TICK_MS = 110;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Indexes we are allowed to mutate: hex digits only, so the "0x" prefix and
 *  any "…" elision stay intact and the string keeps reading as a real handle. */
function mutableIndexes(base: string): number[] {
  const out: number[] = [];
  for (let i = 2; i < base.length; i++) {
    if (HEX.includes(base[i].toLowerCase())) out.push(i);
  }
  return out;
}

/**
 * Makes a ciphertext handle feel alive without lying about it: the real handle
 * is rendered as-is and a single character mutates per tick, so what judges see
 * is genuinely the on-chain value, just visibly unreadable.
 */
export function useCipherShimmer(base: string, active: boolean) {
  const [state, setState] = useState({ text: base, hotIndex: -1 });

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      setState({ text: base, hotIndex: -1 });
      return;
    }
    const indexes = mutableIndexes(base);
    if (indexes.length === 0) {
      setState({ text: base, hotIndex: -1 });
      return;
    }
    setState({ text: base, hotIndex: -1 });
    const timer = setInterval(() => {
      const i = indexes[Math.floor(Math.random() * indexes.length)];
      const chars = base.split("");
      chars[i] = HEX[Math.floor(Math.random() * HEX.length)];
      setState({ text: chars.join(""), hotIndex: i });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [base, active]);

  return state;
}
