import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import {
  deployVeilSwapFixture,
  depositAs,
  submitIntentAs,
  decryptBalance,
  assertExactBalanceViaWithdraw,
  gasUsed,
  ONE_A,
  ONE_B,
} from "./helpers/veilswap-test-fixture.js";

const PHASE = { None: 0, Open: 1, Locked: 2, Settled: 3, Cancelled: 4 };

/** Locks the current epoch and settles it with real publicly-decrypted proofs. */
async function lockAndSettle(fixture: Awaited<ReturnType<typeof deployVeilSwapFixture>>) {
  const epochId = await fixture.pair.read.currentEpochId();
  const lockHash = await fixture.pair.write.lockEpoch();
  const [sumAHandle, sumBHandle] = await fixture.pair.read.epochSumHandles([epochId]);
  const sumA = await nox.publicDecrypt(sumAHandle as any);
  const sumB = await nox.publicDecrypt(sumBHandle as any);
  const settleHash = await fixture.pair.write.settleEpoch([sumA.decryptionProof, sumB.decryptionProof]);
  return { epochId, lockHash, settleHash, sumA: sumA.value as bigint, sumB: sumB.value as bigint };
}

describe("VeilSwapPair epoch lifecycle", async () => {
  it("nets opposing intents and routes only the residual through the router", async () => {
    const fixture = await deployVeilSwapFixture({ maxIntentsPerEpoch: 2 });
    const [user1, user2] = fixture.wallets;

    // user1 sells 1 A for B; user2 sells 1000 B for A. At 1 A = 2500 B the B side
    // is fully matched internally: only 0.6 A should ever reach the public router.
    await depositAs(fixture, user1, fixture.tokenA, ONE_A);
    await depositAs(fixture, user2, fixture.tokenB, 1000n * ONE_B);
    const submit1 = await submitIntentAs(fixture, user1, true, ONE_A, 0n);
    const submit2 = await submitIntentAs(fixture, user2, false, 1000n * ONE_B, 0n);

    const { epochId, lockHash, settleHash, sumA, sumB } = await lockAndSettle(fixture);
    assert.equal(sumA, ONE_A);
    assert.equal(sumB, 1000n * ONE_B);

    // Exactly ONE aggregate swap hit the public market, sized to the residual.
    assert.equal(await fixture.router.read.callCount(), 1n);
    const [settledA, settledB, sellAResidual, residualIn, uniswapOut] =
      await fixture.pair.read.epochSettlement([epochId]);
    assert.equal(settledA, ONE_A);
    assert.equal(settledB, 1000n * ONE_B);
    assert.equal(sellAResidual, true);
    assert.equal(residualIn, 6n * 10n ** 17n); // 0.6 A residual
    assert.equal(uniswapOut, 1500n * ONE_B);

    // user1: 1 A sold → 2500 B total (1000 internal + 1500 from the router).
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenB), 2500n * ONE_B);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 0n);
    // user2: 1000 B sold → exactly 0.4 A, proven through the withdraw path.
    await assertExactBalanceViaWithdraw(
      fixture,
      user2,
      fixture.tokenA,
      4n * 10n ** 17n,
      "0x00000000000000000000000000000000000000d4"
    );

    // A fresh epoch is open for business.
    const [phase] = await fixture.pair.read.epochStatus([epochId + 1n]);
    assert.equal(phase, PHASE.Open);

    // Informational gas figures for MAX_INTENTS calibration.
    console.log(
      `[gas] submit1=${await gasUsed(fixture, submit1)} submit2=${await gasUsed(fixture, submit2)} ` +
        `lock=${await gasUsed(fixture, lockHash)} settle=${await gasUsed(fixture, settleHash)}`
    );
  });

  it("settles a perfectly netted epoch without touching the router at all", async () => {
    const fixture = await deployVeilSwapFixture({ maxIntentsPerEpoch: 2 });
    const [user1, user2] = fixture.wallets;

    // 0.4 A vs 1000 B at 2500 B/A: both sides match exactly, zero residual.
    await depositAs(fixture, user1, fixture.tokenA, 4n * 10n ** 17n);
    await depositAs(fixture, user2, fixture.tokenB, 1000n * ONE_B);
    await submitIntentAs(fixture, user1, true, 4n * 10n ** 17n, 0n);
    await submitIntentAs(fixture, user2, false, 1000n * ONE_B, 0n);

    const { epochId } = await lockAndSettle(fixture);

    // This volume NEVER touched the public chain's market.
    assert.equal(await fixture.router.read.callCount(), 0n);
    const [, , , residualIn] = await fixture.pair.read.epochSettlement([epochId]);
    assert.equal(residualIn, 0n);

    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenB), 1000n * ONE_B);
    await assertExactBalanceViaWithdraw(
      fixture,
      user2,
      fixture.tokenA,
      4n * 10n ** 17n,
      "0x00000000000000000000000000000000000000e5"
    );
  });

  it("excludes and refunds intents whose minOut cannot be guaranteed, settling the rest", async () => {
    const fixture = await deployVeilSwapFixture({ maxIntentsPerEpoch: 2 });
    const [user1, user2] = fixture.wallets;

    await depositAs(fixture, user1, fixture.tokenA, ONE_A);
    await depositAs(fixture, user2, fixture.tokenB, 1000n * ONE_B);
    // user1 demands 5000 B for 1 A — impossible at 2500 B/A: must be excluded.
    await submitIntentAs(fixture, user1, true, ONE_A, 5000n * ONE_B);
    // user2 accepts >= 0.3 A for 1000 B (worst case pays ~0.398 A): eligible.
    await submitIntentAs(fixture, user2, false, 1000n * ONE_B, 3n * 10n ** 17n);

    const { sumA, sumB } = await lockAndSettle(fixture);
    assert.equal(sumA, 0n); // user1's side was excluded before batching
    assert.equal(sumB, 1000n * ONE_B);

    // user1 got their escrow back at lock time and received no tokenB.
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), ONE_A);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenB), 0n);
    // user2's one-sided flow went through the router: 1000 B → 0.4 A.
    assert.equal(await fixture.router.read.callCount(), 1n);
    await assertExactBalanceViaWithdraw(
      fixture,
      user2,
      fixture.tokenA,
      4n * 10n ** 17n,
      "0x00000000000000000000000000000000000000f6"
    );
  });

  it("rolls an empty epoch forward when the deadline passes with no intents", async () => {
    const fixture = await deployVeilSwapFixture({ epochDuration: 0n });
    await fixture.pair.write.lockEpoch(); // deadline == openedAt, zero intents
    const [phase1] = await fixture.pair.read.epochStatus([1n]);
    assert.equal(phase1, PHASE.Settled);
    assert.equal(await fixture.pair.read.currentEpochId(), 2n);
  });

  it("cancels a stuck locked epoch and refunds every batched escrow", async () => {
    const fixture = await deployVeilSwapFixture({ maxIntentsPerEpoch: 1, cancelGracePeriod: 0n });
    const [user1] = fixture.wallets;

    await depositAs(fixture, user1, fixture.tokenA, ONE_A);
    await submitIntentAs(fixture, user1, true, ONE_A, 0n);
    await fixture.pair.write.lockEpoch(); // epoch full → lockable before deadline
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 0n);

    // Advance one block so block.timestamp > lockedAt (grace period is zero).
    await fixture.tokenA.write.mint([user1.account.address, 1n]);

    await fixture.pair.write.cancelEpoch();
    const [phase] = await fixture.pair.read.epochStatus([1n]);
    assert.equal(phase, PHASE.Cancelled);
    // Full escrow restored; a fresh epoch is open.
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), ONE_A);
    assert.equal(await fixture.pair.read.currentEpochId(), 2n);
  });
});
