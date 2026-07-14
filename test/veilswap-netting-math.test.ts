import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Pure plaintext netting math (VeilSwapEpochLib) — no encrypted types involved,
 * so every branch and rounding edge is asserted exactly, to the wei.
 *
 * Price convention: 1 tokenA (18d) = 2500 tokenB (6d)
 *   priceAtoBE18 = 2500e6 * 1e18 / 1e18 = 2.5e9
 *   priceBtoAE18 = 1e18 * 1e18 / 2500e6 = 4e26
 */
const PRICE_A_TO_B = 2_500_000_000n; // 2.5e9
const PRICE_B_TO_A = 4n * 10n ** 26n;
// sqrt(token1/token0) in Q64.96 for token0 = B (6d), token1 = A (18d):
// token1-per-token0 raw ratio = 1e18 / 2500e6 = 4e8, sqrt = 20000.
const SQRT_PRICE_X96 = 20_000n * 2n ** 96n;

describe("VeilSwapEpochLib netting math", async () => {
  let harness: any;

  before(async () => {
    const { viem } = await nox.connect();
    harness = await viem.deployContract("VeilSwapEpochLibHarness", []);
  });

  it("converts sqrtPriceX96 into both spot prices (A is token1)", async () => {
    const [aToB, bToA] = await harness.read.spotPricesE18([SQRT_PRICE_X96, false]);
    assert.equal(aToB, PRICE_A_TO_B);
    assert.equal(bToA, PRICE_B_TO_A);
  });

  it("swaps orientation when A is token0", async () => {
    const [aToB, bToA] = await harness.read.spotPricesE18([SQRT_PRICE_X96, true]);
    assert.equal(aToB, PRICE_B_TO_A);
    assert.equal(bToA, PRICE_A_TO_B);
  });

  it("applies slippage floor to worst-case prices and outputs", async () => {
    assert.equal(await harness.read.worstPriceE18([PRICE_A_TO_B, 50n]), (PRICE_A_TO_B * 9950n) / 10000n);
    // 1 A at 50 bps slippage → 2487.5 B floor-truncated
    assert.equal(await harness.read.worstCaseOut([10n ** 18n, PRICE_A_TO_B, 50n]), 2_487_500_000n);
    // Slippage >= 100% is rejected
    await assert.rejects(harness.read.worstPriceE18([PRICE_A_TO_B, 10000n]));
  });

  it("nets an A-heavy epoch: B fully matched, A residual to Uniswap", async () => {
    const sumA = 10n ** 18n; // 1 A
    const sumB = 1_000_000_000n; // 1000 B
    const plan = await harness.read.computeSettlement([sumA, sumB, PRICE_A_TO_B]);
    assert.equal(plan.sellAResidual, true);
    assert.equal(plan.internalOutA, sumB); // A-side receives all of B's input
    assert.equal(plan.internalOutB, 4n * 10n ** 17n); // B-side receives 0.4 A
    assert.equal(plan.residualIn, 6n * 10n ** 17n); // 0.6 A goes to Uniswap
    // Solvency: tokenA out == sumA exactly
    assert.equal(plan.internalOutB + plan.residualIn, sumA);
  });

  it("nets a B-heavy epoch: A fully matched, B residual to Uniswap", async () => {
    const sumA = 4n * 10n ** 17n; // 0.4 A → worth 1000 B
    const sumB = 2_500_000_000n; // 2500 B
    const plan = await harness.read.computeSettlement([sumA, sumB, PRICE_A_TO_B]);
    assert.equal(plan.sellAResidual, false);
    assert.equal(plan.internalOutA, 1_000_000_000n); // A-side receives its B value
    assert.equal(plan.internalOutB, sumA);
    assert.equal(plan.residualIn, 1_500_000_000n); // 1500 B to Uniswap
    // Solvency: tokenB out == sumB exactly
    assert.equal(plan.internalOutA + plan.residualIn, sumB);
  });

  it("fully nets a perfectly balanced epoch (zero residual)", async () => {
    const plan = await harness.read.computeSettlement([4n * 10n ** 17n, 1_000_000_000n, PRICE_A_TO_B]);
    assert.equal(plan.residualIn, 0n);
    assert.equal(plan.internalOutA, 1_000_000_000n);
    assert.equal(plan.internalOutB, 4n * 10n ** 17n);
  });

  it("handles one-sided and empty epochs", async () => {
    const onlyA = await harness.read.computeSettlement([10n ** 18n, 0n, PRICE_A_TO_B]);
    assert.equal(onlyA.sellAResidual, true);
    assert.equal(onlyA.residualIn, 10n ** 18n);
    assert.equal(onlyA.internalOutA + onlyA.internalOutB, 0n);

    const onlyB = await harness.read.computeSettlement([0n, 1_000_000_000n, PRICE_A_TO_B]);
    assert.equal(onlyB.sellAResidual, false);
    assert.equal(onlyB.residualIn, 1_000_000_000n);

    const empty = await harness.read.computeSettlement([0n, 0n, PRICE_A_TO_B]);
    assert.equal(empty.residualIn, 0n);
  });

  it("keeps rounding dust in the contract, never over-allocates", async () => {
    // Odd amounts that do not divide evenly at the price.
    const sumA = 333_333_333_333_333_333n; // ~0.333 A → 833.33... B value
    const sumB = 1_000_000_000n;
    const plan = await harness.read.computeSettlement([sumA, sumB, PRICE_A_TO_B]);
    const aInB = (sumA * PRICE_A_TO_B) / 10n ** 18n; // floor
    assert.equal(plan.sellAResidual, false);
    assert.equal(plan.internalOutA, aInB);
    // Every payout is a floor of the true value: totals never exceed inputs.
    assert.ok(plan.internalOutA <= sumB);
    assert.equal(plan.internalOutA + plan.residualIn, sumB);
  });
});
