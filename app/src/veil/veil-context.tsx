import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** "yours" = plaintext you are entitled to read. "chain" = the observer's eye
 *  view: only what an indexer could actually pull off Sepolia. */
export type VeilView = "chain" | "yours";

type VeilState = {
  view: VeilView;
  chainView: boolean;
  setView: (view: VeilView) => void;
};

const VeilContext = createContext<VeilState | null>(null);

export function VeilProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<VeilView>("yours");
  const value = useMemo(() => ({ view, chainView: view === "chain", setView }), [view]);
  return <VeilContext.Provider value={value}>{children}</VeilContext.Provider>;
}

export function useVeil(): VeilState {
  const context = useContext(VeilContext);
  if (!context) throw new Error("useVeil must be used inside <VeilProvider>");
  return context;
}
