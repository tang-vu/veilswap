import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";

/**
 * WalletConnect projectId is optional for the demo: injected wallets (MetaMask,
 * Rabby…) work without it. Set VITE_WALLETCONNECT_PROJECT_ID to enable
 * WalletConnect QR flows.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "VeilSwap",
  projectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "veilswap-local-demo",
  chains: [sepolia],
  transports: {
    // drpc: free tier supports the eth_getLogs range queries the dashboard
    // uses to link settlement transactions (publicnode gates those).
    [sepolia.id]: http((import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) ?? "https://sepolia.drpc.org"),
  },
  ssr: false,
});
