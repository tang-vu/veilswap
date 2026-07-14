import { strict as assert } from "node:assert";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";

/**
 * Shared local-chain fixture: two test tokens (A: 18 decimals "WETH-like",
 * B: 6 decimals "USDC-like"), a pool stub priced at 1 A = 2500 B, a
 * deterministic router stub with funded inventory, and a VeilSwapPair.
 *
 * On Sepolia the real Uniswap V3 pool/router replace the two stubs; the
 * VeilSwap contracts are identical.
 */

export const PRICE_A_TO_B = 2_500_000_000n; // tokenB per tokenA, 1e18-scaled (2.5e9)
export const PRICE_B_TO_A = 4n * 10n ** 26n; // tokenA per tokenB, 1e18-scaled
// token0 = B, token1 = A → sqrt(token1/token0 raw) = sqrt(4e8) = 20000 in Q64.96.
export const SQRT_PRICE_X96 = 20_000n * 2n ** 96n;

export const ONE_A = 10n ** 18n;
export const ONE_B = 10n ** 6n;

export interface PairOptions {
  epochDuration?: bigint;
  maxIntentsPerEpoch?: number;
  slippageBps?: number;
  cancelGracePeriod?: bigint;
}

export async function deployVeilSwapFixture(options: PairOptions = {}) {
  const connection = await nox.connect();
  const { viem } = connection as any;
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();

  const tokenA = await viem.deployContract("TestERC20", ["Test Wrapped Ether", "tWETH", 18]);
  const tokenB = await viem.deployContract("TestERC20", ["Test USD Coin", "tUSDC", 6]);
  const pool = await viem.deployContract("TestUniswapV3Pool", [
    tokenB.address, // token0
    tokenA.address, // token1
    SQRT_PRICE_X96,
  ]);
  const router = await viem.deployContract("TestSwapRouter", []);
  await router.write.setPriceE18([tokenA.address, tokenB.address, PRICE_A_TO_B]);
  await router.write.setPriceE18([tokenB.address, tokenA.address, PRICE_B_TO_A]);
  // Router inventory so it can always fill the residual leg.
  await tokenA.write.mint([router.address, 1_000_000n * ONE_A]);
  await tokenB.write.mint([router.address, 1_000_000_000n * ONE_B]);

  const pair = await viem.deployContract("VeilSwapPair", [
    tokenA.address,
    tokenB.address,
    pool.address,
    router.address,
    500, // poolFee (unused by the stub, forwarded on Sepolia)
    options.epochDuration ?? 3600n,
    options.maxIntentsPerEpoch ?? 4,
    options.slippageBps ?? 50,
    options.cancelGracePeriod ?? 3600n,
  ]);

  return {
    connection,
    viem,
    publicClient,
    wallets,
    tokenA,
    tokenB,
    pool,
    router,
    pair,
    handleClients: new Map<string, HandleClient>(),
  };
}

/**
 * Input proofs from the Handle Gateway are bound to the encrypting wallet
 * (NoxCompute rejects them with "Owner mismatch" if another address submits
 * them). Each test wallet therefore needs its own Handle SDK client — exactly
 * like every user's browser session in production.
 */
export async function getHandleClientFor(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  wallet: any
): Promise<HandleClient> {
  const key = wallet.account.address.toLowerCase();
  let client = fixture.handleClients.get(key);
  if (!client) {
    // Local-stack wiring, matching the plugin's own internals: the gateway's
    // Docker-assigned host port is published via env by the plugin process, and
    // NoxCompute is always etched at the same well-known local address.
    const gatewayPort = process.env.NOX_HANDLE_GATEWAY_HOST_PORT;
    if (!gatewayPort) throw new Error("NOX_HANDLE_GATEWAY_HOST_PORT not set — is the Nox stack up?");
    // The SDK derives the input owner from `getAddresses()[0]`, and Hardhat's
    // provider returns ALL local accounts there (account #0 first) regardless of
    // which account this wallet client is bound to. Pin it to the bound account,
    // otherwise proofs carry the wrong owner and NoxCompute rejects them.
    const boundWallet = { ...wallet, getAddresses: async () => [wallet.account.address] };
    client = await createViemHandleClient(boundWallet, {
      gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
      smartContractAddress: "0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685",
      // Required by config validation, never queried by these tests.
      subgraphUrl: "https://example.com/subgraphs/id/none",
    });
    fixture.handleClients.set(key, client);
  }
  return client;
}

/** Encrypts a value with the given wallet's own handle client. */
export async function encryptAs(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  wallet: any,
  value: bigint | boolean,
  solidityType: "uint256" | "bool"
): Promise<{ handle: `0x${string}`; handleProof: `0x${string}` }> {
  const client = await getHandleClientFor(fixture, wallet);
  const result = await client.encryptInput(value as any, solidityType, fixture.pair.address);
  return { handle: result.handle as `0x${string}`, handleProof: result.handleProof as `0x${string}` };
}

/** Mints, approves and deposits `amount` of `token` for `wallet`. */
export async function depositAs(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  wallet: any,
  token: any,
  amount: bigint
) {
  const { viem, pair } = fixture;
  const tokenAs = await viem.getContractAt("TestERC20", token.address, { client: { wallet } });
  await tokenAs.write.mint([wallet.account.address, amount]);
  await tokenAs.write.approve([pair.address, amount]);
  const pairAs = await viem.getContractAt("VeilSwapPair", pair.address, { client: { wallet } });
  await pairAs.write.deposit([token.address, amount]);
  return pairAs;
}

/** Encrypts (direction, amountIn, minOut) and submits an intent as `wallet`. */
export async function submitIntentAs(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  wallet: any,
  sellAForB: boolean,
  amountIn: bigint,
  minOut: bigint
): Promise<`0x${string}`> {
  const { viem, pair } = fixture;
  const dir = await encryptAs(fixture, wallet, sellAForB, "bool");
  const amount = await encryptAs(fixture, wallet, amountIn, "uint256");
  const limit = await encryptAs(fixture, wallet, minOut, "uint256");
  const pairAs = await viem.getContractAt("VeilSwapPair", pair.address, { client: { wallet } });
  return pairAs.write.submitIntent([
    dir.handle,
    amount.handle,
    limit.handle,
    dir.handleProof,
    amount.handleProof,
    limit.handleProof,
  ]);
}

/** Decrypts the caller-owned encrypted balance of `user` (default test account only). */
export async function decryptBalance(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  user: `0x${string}`,
  token: any
): Promise<bigint> {
  const handle = await fixture.pair.read.balanceHandle([user, token.address]);
  const { value } = await nox.decrypt(handle as any);
  return value as bigint;
}

/**
 * Proves a user's encrypted balance equals `expected` without needing their
 * decryption key: withdraws exactly `expected` to a fresh address (must arrive
 * in full), then attempts a 1-wei overdraw (must yield 0 — all-or-nothing).
 * This exercises the real withdraw path, so it doubles as an integration check.
 */
export async function assertExactBalanceViaWithdraw(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  wallet: any,
  token: any,
  expected: bigint,
  freshRecipient: `0x${string}`
) {
  const { viem, pair } = fixture;
  const pairAs = await viem.getContractAt("VeilSwapPair", pair.address, { client: { wallet } });

  const enc = await encryptAs(fixture, wallet, expected, "uint256");
  await pairAs.write.requestWithdraw([token.address, freshRecipient, enc.handle, enc.handleProof]);
  const requestId = await findLatestWithdrawRequestId(fixture, wallet.account.address);
  const { value, decryptionProof } = await nox.publicDecrypt(requestId as any);
  assert.equal(value, expected, "withdrawn amount mismatch (balance was insufficient?)");
  await pairAs.write.finalizeWithdraw([requestId, decryptionProof]);
  assert.equal(await token.read.balanceOf([freshRecipient]), expected);

  if (expected > 0n) {
    // Overdraw probe: any remaining balance would let 1 wei through.
    const one = await encryptAs(fixture, wallet, 1n, "uint256");
    await pairAs.write.requestWithdraw([token.address, freshRecipient, one.handle, one.handleProof]);
    const probeId = await findLatestWithdrawRequestId(fixture, wallet.account.address);
    const probe = await nox.publicDecrypt(probeId as any);
    assert.equal(probe.value, 0n, "balance not empty after exact withdraw");
  }
}

/** Reads the latest WithdrawRequested requestId emitted for `user`. */
export async function findLatestWithdrawRequestId(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  user: `0x${string}`
): Promise<`0x${string}`> {
  const events = await fixture.publicClient.getContractEvents({
    address: fixture.pair.address,
    abi: fixture.pair.abi,
    eventName: "WithdrawRequested",
    args: { user },
    fromBlock: 0n,
  });
  const last = events[events.length - 1];
  return last.args.requestId as `0x${string}`;
}

/** Waits for a tx and returns its gasUsed (for informational gas calibration). */
export async function gasUsed(
  fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>,
  hash: `0x${string}`
): Promise<bigint> {
  const receipt = await fixture.publicClient.waitForTransactionReceipt({ hash });
  return receipt.gasUsed;
}
