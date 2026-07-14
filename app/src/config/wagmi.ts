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
    [sepolia.id]: http(
      (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) ?? "https://ethereum-sepolia-rpc.publicnode.com"
    ),
  },
  ssr: false,
});
