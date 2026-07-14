import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

/**
 * Deploys VeilSwapPair to Ethereum Sepolia against the REAL Uniswap V3
 * WETH/USDC pool and SwapRouter02, then records the address into
 * deployments.json (root + app copy).
 *
 *   pnpm deploy:sepolia
 *
 * Afterwards verify with:
 *   pnpm hardhat verify --network sepolia <address> <constructor args…>
 * (the exact command is printed below).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsPath = join(root, "deployments.json");
const deployments = JSON.parse(readFileSync(deploymentsPath, "utf8"));

const EPOCH_DURATION = BigInt(deployments.epochDurationSeconds ?? 300); // 5 min demo epochs
const MAX_INTENTS = 8; // calibrated from local gas: lock ≈ 0.5M gas per intent
const SLIPPAGE_BPS = 50; // 0.5% worst-case bound for eligibility + amountOutMinimum
const CANCEL_GRACE = 1800n; // 30 min before a stuck epoch can be cancelled

const connection = await network.connect("sepolia");
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
console.log(`Deployer: ${deployer.account.address} on chain ${await publicClient.getChainId()}`);

const constructorArgs = [
  deployments.tokenA.address,
  deployments.tokenB.address,
  deployments.uniswapV3Pool,
  deployments.swapRouter02,
  deployments.poolFee,
  EPOCH_DURATION,
  MAX_INTENTS,
  SLIPPAGE_BPS,
  CANCEL_GRACE,
] as const;

const { contract: pair, deploymentTransaction } = await viem.sendDeploymentTransaction("VeilSwapPair", [
  ...constructorArgs,
]);
console.log(`Deployment tx: ${deploymentTransaction.hash} — waiting for confirmation…`);
const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
if (receipt.status !== "success") throw new Error("Deployment reverted");

deployments.veilSwapPair = pair.address;
deployments.deployedAtBlock = Number(receipt.blockNumber);
deployments.deployTxHash = receipt.transactionHash;
writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);
console.log(`VeilSwapPair deployed at ${pair.address} (block ${receipt.blockNumber})`);
console.log(`Recorded in deployments.json — now run: pnpm tsx scripts/export-abi-to-app.ts`);
console.log(
  `Verify: pnpm hardhat verify --network sepolia ${pair.address} ${constructorArgs
    .map((arg) => String(arg))
    .join(" ")}`
);
