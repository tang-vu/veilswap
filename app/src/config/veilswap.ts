import deployments from "./deployments.json";
import { veilSwapPairAbi } from "./veilswap-pair-abi";

/**
 * Single source of truth for chain wiring. The pair address can be overridden
 * with VITE_VEILSWAP_PAIR_ADDRESS (useful between deploy and committing
 * deployments.json).
 */
export type TokenInfo = { address: `0x${string}`; symbol: string; decimals: number };

export const CHAIN_ID = deployments.chainId;

export const PAIR_ADDRESS = ((import.meta.env.VITE_VEILSWAP_PAIR_ADDRESS as string | undefined) ??
  deployments.veilSwapPair) as `0x${string}`;

export const TOKEN_A: TokenInfo = deployments.tokenA as TokenInfo; // WETH
export const TOKEN_B: TokenInfo = deployments.tokenB as TokenInfo; // USDC
export const POOL_ADDRESS = deployments.uniswapV3Pool as `0x${string}`;

export const PAIR_ABI = veilSwapPairAbi;

export const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

export function tokenByAddress(address: string): TokenInfo {
  return address.toLowerCase() === TOKEN_A.address.toLowerCase() ? TOKEN_A : TOKEN_B;
}

/** Minimal ERC-20 surface used by the app. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** WETH9 deposit() — lets judges wrap Sepolia ETH into WETH without leaving the app. */
export const WETH_DEPOSIT_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

/** Minimal Uniswap V3 pool surface (spot quote for the intent form). */
export const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
