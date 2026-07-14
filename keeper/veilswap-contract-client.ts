import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";

/**
 * Shared wiring for the VeilSwap keeper: viem clients, the VeilSwapPair binding
 * (ABI loaded from Hardhat artifacts) and a Nox Handle SDK client used to
 * publicly decrypt the locked epoch totals.
 *
 * Environment:
 *   VEILSWAP_PAIR_ADDRESS  deployed pair (required)
 *   KEEPER_PRIVATE_KEY     tx signer (falls back to PRIVATE_KEY)
 *   SEPOLIA_RPC_URL        RPC endpoint (defaults to a public one)
 *   NOX_GATEWAY_URL / NOX_CONTRACT_ADDRESS / NOX_SUBGRAPH_URL
 *                          optional overrides for non-Sepolia targets
 */

const __dir = dirname(fileURLToPath(import.meta.url));

export function loadPairAbi(): Abi {
  const artifactPath = join(__dir, "..", "artifacts", "contracts", "VeilSwapPair.sol", "VeilSwapPair.json");
  return JSON.parse(readFileSync(artifactPath, "utf8")).abi as Abi;
}

export interface KeeperContext {
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  pairAddress: Address;
  pairAbi: Abi;
  handleClient: HandleClient;
}

export async function createKeeperContext(): Promise<KeeperContext> {
  const pairAddress = requireEnv("VEILSWAP_PAIR_ADDRESS") as Address;
  const privateKey = (process.env.KEEPER_PRIVATE_KEY ?? requireEnv("PRIVATE_KEY")) as `0x${string}`;
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

  const chain = sepolia;
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  // The SDK ships built-in config for Sepolia (11155111); env vars can override
  // for local-stack experiments.
  const overrides: Record<string, string> = {};
  if (process.env.NOX_GATEWAY_URL) overrides.gatewayUrl = process.env.NOX_GATEWAY_URL;
  if (process.env.NOX_CONTRACT_ADDRESS) overrides.smartContractAddress = process.env.NOX_CONTRACT_ADDRESS;
  if (process.env.NOX_SUBGRAPH_URL) overrides.subgraphUrl = process.env.NOX_SUBGRAPH_URL;
  const handleClient = await createViemHandleClient(
    walletClient,
    overrides as Parameters<typeof createViemHandleClient>[1]
  );

  return { chain, publicClient, walletClient, account, pairAddress, pairAbi: loadPairAbi(), handleClient };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

/** Simulates, sends and waits for a pair-contract write; returns the tx hash. */
export async function writePair(
  ctx: KeeperContext,
  functionName: string,
  args: readonly unknown[] = []
): Promise<`0x${string}`> {
  const { request } = await ctx.publicClient.simulateContract({
    address: ctx.pairAddress,
    abi: ctx.pairAbi,
    functionName,
    args: args as unknown[],
    account: ctx.account,
  });
  const hash = await ctx.walletClient.writeContract(request);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}

export async function readPair<T>(ctx: KeeperContext, functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await ctx.publicClient.readContract({
    address: ctx.pairAddress,
    abi: ctx.pairAbi,
    functionName,
    args: args as unknown[],
  })) as T;
}
