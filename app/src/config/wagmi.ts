import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";

/**
 * WalletConnect projectId is optional for the demo: injected wallets (MetaMask,
 * Rabby…) work without it, though WalletConnect's own config/telemetry calls
 * will 4xx in the console and mobile QR pairing stays unavailable. Set
 * VITE_WALLETCONNECT_PROJECT_ID to enable WalletConnect QR flows.
 *
 * Trimmed truthiness rather than ??: CI passes an unset repository variable
 * through as an empty string, which is not null and would otherwise sail past
 * the fallback and leave projectId blank.
 */
const walletConnectProjectId =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || "veilswap-local-demo";

export const wagmiConfig = getDefaultConfig({
  appName: "VeilSwap",
  projectId: walletConnectProjectId,
  chains: [sepolia],
  transports: {
    // drpc: free tier supports the eth_getLogs range queries the dashboard
    // uses to link settlement transactions (publicnode gates those).
    [sepolia.id]: http((import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) ?? "https://sepolia.drpc.org"),
  },
  ssr: false,
});
