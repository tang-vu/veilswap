import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  type Abi,
  type Address,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";

/**
 * Full end-to-end rehearsal of docs/DEMO_SCRIPT.md against LIVE Sepolia:
 * real Uniswap V3, real Nox protocol, three funded wallets from .env.
 * Prints every tx hash as a markdown table for the README.
 *
 *   pnpm tsx scripts/e2e-demo-rehearsal.ts
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployments = JSON.parse(readFileSync(join(root, "deployments.json"), "utf8"));
const pairAbi = JSON.parse(
  readFileSync(join(root, "artifacts", "contracts", "VeilSwapPair.sol", "VeilSwapPair.json"), "utf8")
).abi as Abi;

const PAIR = deployments.veilSwapPair as Address;
const WETH = deployments.tokenA.address as Address;
const USDC = deployments.tokenB.address as Address;
const POOL = deployments.uniswapV3Pool as Address;
const ROUTER = deployments.swapRouter02 as Address;

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const transport = http(RPC);
const publicClient = createPublicClient({ chain: sepolia, transport });

const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "a", type: "uint16" },
      { name: "b", type: "uint16" },
      { name: "c", type: "uint16" },
      { name: "d", type: "uint8" },
      { name: "e", type: "bool" },
    ],
  },
] as const;

function wallet(envName: string): WalletClient {
  const key = process.env[envName];
  if (!key) throw new Error(`Missing ${envName} in .env`);
  return createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(key as `0x${string}`) });
}

/** SDK owner binding fix: getAddresses() must return only the bound account. */
async function handleClientFor(walletClient: WalletClient): Promise<HandleClient> {
  const account = walletClient.account!;
  return createViemHandleClient({ ...walletClient, getAddresses: async () => [account.address] } as WalletClient);
}

const hashes: Array<[string, string]> = [];
async function send(
  walletClient: WalletClient,
  label: string,
  request: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }
) {
  const callArgs = {
    ...request,
    args: (request.args ?? []) as unknown[],
    account: walletClient.account!,
  };
  const { request: prepared } = await publicClient.simulateContract(callArgs as never);
  // Explicit gas at 2x the estimate: pool/Nox state can shift between
  // estimation and execution (observed: settle OOG'd at the estimated limit
  // when another trade moved the pool mid-flight). simulateContract does NOT
  // set `gas` on its returned request, so this must be estimated separately.
  const gasEstimate = await publicClient.estimateContractGas(callArgs as never);
  const hash = await walletClient.writeContract({ ...(prepared as object), gas: gasEstimate * 2n } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  hashes.push([label, hash]);
  console.log(`✔ ${label}: ${hash} (gas ${receipt.gasUsed})`);
  return receipt;
}

async function readPair<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await publicClient.readContract({ address: PAIR, abi: pairAbi, functionName, args: args as unknown[] })) as T;
}

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 40, delayMs = 15_000): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(`  … ${label} not ready (attempt ${i}/${attempts}), waiting ${delayMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastError)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============ actors ============
const keeper = wallet("KEEPER_PRIVATE_KEY");
const alice = wallet("ALICE_PRIVATE_KEY");
const bob = wallet("BOB_PRIVATE_KEY");
const aliceNox = await handleClientFor(alice);
const bobNox = await handleClientFor(bob);
const keeperNox = await handleClientFor(keeper);
const freshExitKey = generatePrivateKey();
const freshExit = privateKeyToAccount(freshExitKey).address;
console.log(`Actors — keeper ${keeper.account!.address}, alice ${alice.account!.address}, bob ${bob.account!.address}`);
console.log(`Fresh exit address (never funded): ${freshExit}`);

// ============ price-derived demo sizing ============
const ALICE_WETH_IN = 10n ** 16n; // Alice sells 0.01 WETH
const BOB_USDC_IN = 100n * 10n ** 6n; // Bob sells 100 USDC

/** Fresh spot quote from the pool; called right before it is used so testnet
 *  price drift can't silently invalidate the derived limits. */
async function spotQuote() {
  const [sqrtPriceX96] = await publicClient.readContract({ address: POOL, abi: POOL_ABI, functionName: "slot0" });
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  // token0 = USDC, token1 = WETH for this pool: aToB (USDC per WETH-wei, 1e18) = zeroFor1.
  const usdcPerWethE18 = ((1n << 192n) * 10n ** 18n) / priceX192;
  const wethPerUsdcE18 = (priceX192 * 10n ** 18n) >> 192n;
  console.log(`Pool spot: 1 WETH ≈ ${(Number(usdcPerWethE18 * 10n ** 12n) / 1e18).toFixed(0)} USDC`);
  return { usdcPerWethE18, wethPerUsdcE18 };
}

// ============ 0. one-time demo funding ============
async function fundDemoWallets() {
  const aliceWeth = await publicClient.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [alice.account!.address] });
  if (aliceWeth < ALICE_WETH_IN) {
    await send(alice, "alice wraps 0.012 ETH → WETH", { address: WETH, abi: WETH_ABI as unknown as Abi, functionName: "deposit", value: 12n * 10n ** 15n });
  }
  const bobUsdc = await publicClient.readContract({ address: USDC, abi: WETH_ABI, functionName: "balanceOf", args: [bob.account!.address] });
  if (bobUsdc < BOB_USDC_IN + 15n * 10n ** 6n) {
    // Bob sources USDC from the same public pool (wrap, then market-swap).
    const bobWethIn = 8n * 10n ** 15n; // 0.008 ETH ≈ enough for ~130+ USDC at spot
    await send(bob, "bob wraps 0.008 ETH → WETH", { address: WETH, abi: WETH_ABI as unknown as Abi, functionName: "deposit", value: bobWethIn });
    await send(bob, "bob approves router", { address: WETH, abi: WETH_ABI as unknown as Abi, functionName: "approve", args: [ROUTER, bobWethIn] });
    const { usdcPerWethE18 } = await spotQuote();
    const minUsdc = (bobWethIn * usdcPerWethE18 * 9800n) / (10n ** 18n * 10_000n);
    await send(bob, "bob swaps WETH → USDC (demo funding)", {
      address: ROUTER,
      abi: ROUTER_ABI as unknown as Abi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: WETH, tokenOut: USDC, fee: deployments.poolFee, recipient: bob.account!.address, amountIn: bobWethIn, amountOutMinimum: minUsdc, sqrtPriceLimitX96: 0n }],
    });
  }
}

// ============ 1. make sure a fresh epoch with runway is open ============
async function ensureFreshEpoch(): Promise<bigint> {
  for (;;) {
    const epochId = await readPair<bigint>("currentEpochId");
    const [phase, , deadline] = await readPair<[number, bigint, bigint, bigint, bigint]>("epochStatus", [epochId]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (phase === 1 && deadline > now + 120n) return epochId; // ≥2 min runway
    if (phase === 1 && now >= deadline) {
      await send(keeper, `keeper rolls stale epoch #${epochId}`, { address: PAIR, abi: pairAbi, functionName: "lockEpoch" });
      continue; // empty epoch rolls immediately; intents would need lock+settle
    }
    if (phase === 2) {
      await settleCurrentEpoch(epochId, "keeper settles leftover epoch");
      continue;
    }
    console.log(`  … waiting for a fresh epoch (phase=${phase}, ${deadline - now}s left)`);
    await sleep(15_000);
  }
}

async function settleCurrentEpoch(epochId: bigint, label: string) {
  const [sumAHandle, sumBHandle] = await readPair<[`0x${string}`, `0x${string}`]>("epochSumHandles", [epochId]);
  const sumA = await retry(`publicDecrypt sumA`, () => keeperNox.publicDecrypt(sumAHandle as never));
  const sumB = await retry(`publicDecrypt sumB`, () => keeperNox.publicDecrypt(sumBHandle as never));
  console.log(`  decrypted totals: WETH-side=${formatUnits(sumA.value as bigint, 18)} USDC-side=${formatUnits(sumB.value as bigint, 6)}`);
  return send(keeper, label, {
    address: PAIR,
    abi: pairAbi,
    functionName: "settleEpoch",
    args: [sumA.decryptionProof, sumB.decryptionProof],
  });
}

// ============ 2. the demo flow ============
async function main() {
  await fundDemoWallets();
  const epochId = await ensureFreshEpoch();
  console.log(`Demo epoch: #${epochId}`);

  // Limits derived from a FRESH quote: spot − 4%, below the contract's
  // lock-time bound of lockPrice − 3% with ~1% of drift headroom. (Run 1
  // lesson: a 0.8% margin was eaten by a 1.65% testnet drift and the intent
  // was — correctly — excluded and refunded.)
  const { usdcPerWethE18, wethPerUsdcE18 } = await spotQuote();
  const aliceMinOut = (ALICE_WETH_IN * usdcPerWethE18 * 9600n) / (10n ** 18n * 10_000n);
  const bobMinOut = (BOB_USDC_IN * wethPerUsdcE18 * 9600n) / (10n ** 18n * 10_000n);

  // Deposits (the last public trace of each user).
  await send(alice, "alice approves WETH for VeilSwap", { address: WETH, abi: WETH_ABI as unknown as Abi, functionName: "approve", args: [PAIR, ALICE_WETH_IN] });
  await send(alice, "alice deposits 0.01 WETH", { address: PAIR, abi: pairAbi, functionName: "deposit", args: [WETH, ALICE_WETH_IN] });
  await send(bob, "bob approves USDC for VeilSwap", { address: USDC, abi: WETH_ABI as unknown as Abi, functionName: "approve", args: [PAIR, BOB_USDC_IN] });
  await send(bob, "bob deposits 100 USDC", { address: PAIR, abi: pairAbi, functionName: "deposit", args: [USDC, BOB_USDC_IN] });

  // Encrypted intents: direction, amount and limit are all handles.
  const submitIntent = async (who: WalletClient, nox: HandleClient, label: string, dir: boolean, amountIn: bigint, minOut: bigint) => {
    const [d, a, m] = await Promise.all([
      nox.encryptInput(dir, "bool", PAIR),
      nox.encryptInput(amountIn, "uint256", PAIR),
      nox.encryptInput(minOut, "uint256", PAIR),
    ]);
    return send(who, label, {
      address: PAIR,
      abi: pairAbi,
      functionName: "submitIntent",
      args: [d.handle, a.handle, m.handle, d.handleProof, a.handleProof, m.handleProof],
    });
  };
  await submitIntent(alice, aliceNox, "alice submits encrypted intent (WETH→USDC)", true, ALICE_WETH_IN, aliceMinOut);
  await submitIntent(bob, bobNox, "bob submits encrypted intent (USDC→WETH)", false, BOB_USDC_IN, bobMinOut);

  // Wait out the epoch deadline, then lock + settle (keeper role).
  const [, , deadline] = await readPair<[number, bigint, bigint, bigint, bigint]>("epochStatus", [epochId]);
  const waitSec = Number(deadline) - Math.floor(Date.now() / 1000) + 5;
  if (waitSec > 0) {
    console.log(`  … waiting ${waitSec}s for epoch deadline`);
    await sleep(waitSec * 1000);
  }
  await send(keeper, "keeper locks epoch (encrypted eligibility + sums)", { address: PAIR, abi: pairAbi, functionName: "lockEpoch" });
  const settleReceipt = await settleCurrentEpoch(epochId, "SETTLEMENT — one aggregate Uniswap swap");

  // Decode the settlement record for the README.
  for (const log of settleReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: pairAbi, data: log.data, topics: log.topics as never });
      if (decoded.eventName === "EpochSettled") {
        const args = decoded.args as never as { sumAIn: bigint; sumBIn: bigint; sellAResidual: boolean; residualIn: bigint; uniswapAmountOut: bigint };
        console.log(
          `  settled: batched ${formatUnits(args.sumAIn, 18)} WETH ⇄ ${formatUnits(args.sumBIn, 6)} USDC; ` +
            `residual ${args.sellAResidual ? formatUnits(args.residualIn, 18) + " WETH→USDC" : formatUnits(args.residualIn, 6) + " USDC→WETH"}; ` +
            `uniswap out ${args.sellAResidual ? formatUnits(args.uniswapAmountOut, 6) + " USDC" : formatUnits(args.uniswapAmountOut, 18) + " WETH"}`
        );
      }
    } catch { /* other event */ }
  }

  // Decrypt fills client-side (only the owners can do this).
  const aliceUsdcHandle = await readPair<`0x${string}`>("balanceHandle", [alice.account!.address, USDC]);
  const aliceUsdc = await retry("alice decrypts her USDC fill", () => aliceNox.decrypt(aliceUsdcHandle as never));
  console.log(`  alice's encrypted USDC balance decrypts to: ${formatUnits(aliceUsdc.value as bigint, 6)} USDC`);
  const bobWethHandle = await readPair<`0x${string}`>("balanceHandle", [bob.account!.address, WETH]);
  const bobWeth = await retry("bob decrypts his WETH fill", () => bobNox.decrypt(bobWethHandle as never));
  const bobFill = bobWeth.value as bigint;
  console.log(`  bob's encrypted WETH balance decrypts to: ${formatUnits(bobFill, 18)} WETH`);

  // Private transfer: alice sends bob 10 USDC, amount hidden on-chain.
  const encTransfer = await aliceNox.encryptInput(10n * 10n ** 6n, "uint256", PAIR);
  await send(alice, "alice → bob private transfer (amount hidden)", {
    address: PAIR,
    abi: pairAbi,
    functionName: "confidentialTransfer",
    args: [bob.account!.address, USDC, encTransfer.handle, encTransfer.handleProof],
  });

  // Bob exits his entire WETH fill to a brand-new address.
  const encWithdraw = await bobNox.encryptInput(bobFill, "uint256", PAIR);
  const requestReceipt = await send(bob, "bob requests withdrawal to a FRESH address", {
    address: PAIR,
    abi: pairAbi,
    functionName: "requestWithdraw",
    args: [WETH, freshExit, encWithdraw.handle, encWithdraw.handleProof],
  });
  let requestId: `0x${string}` | undefined;
  for (const log of requestReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: pairAbi, data: log.data, topics: log.topics as never });
      if (decoded.eventName === "WithdrawRequested") requestId = (decoded.args as never as { requestId: `0x${string}` }).requestId;
    } catch { /* other event */ }
  }
  if (!requestId) throw new Error("WithdrawRequested event not found");
  const proof = await retry("publicDecrypt withdraw amount", () => bobNox.publicDecrypt(requestId as never));
  await send(bob, "bob finalizes withdrawal (proof verified on-chain)", {
    address: PAIR,
    abi: pairAbi,
    functionName: "finalizeWithdraw",
    args: [requestId, proof.decryptionProof],
  });
  const exitBalance = await publicClient.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [freshExit] });
  console.log(`  fresh address ${freshExit} now holds ${formatUnits(exitBalance, 18)} WETH (link severed)`);

  // ============ results ============
  console.log("\n===== README tx table =====");
  for (const [label, hash] of hashes) console.log(`| ${label} | [\`${hash.slice(0, 10)}…\`](https://sepolia.etherscan.io/tx/${hash}) |`);
  console.log("\nAll steps completed against live Sepolia + live Nox. ✅");
}

await main();
