import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import {
  deployVeilSwapFixture,
  depositAs,
  encryptAs,
  decryptBalance,
  assertExactBalanceViaWithdraw,
  findLatestWithdrawRequestId,
  ONE_A,
} from "./helpers/veilswap-test-fixture.js";

/**
 * Encrypted ledger behaviour: deposits, owner-only decryption, all-or-nothing
 * confidential transfers, and the two-step withdraw with on-chain proof
 * verification. All flows run against the real local Nox stack (TEE runner,
 * gateway, KMS) — nothing is mocked on the encryption side.
 */
describe("VeilSwapBalances encrypted ledger", async () => {
  it("credits deposits into an encrypted balance the owner can decrypt", async () => {
    const fixture = await deployVeilSwapFixture();
    const [user1] = fixture.wallets;

    await depositAs(fixture, user1, fixture.tokenA, 100n * ONE_A);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 100n * ONE_A);

    // Second deposit accumulates.
    await depositAs(fixture, user1, fixture.tokenA, 50n * ONE_A);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 150n * ONE_A);
  });

  it("rejects unsupported tokens and oversized deposits", async () => {
    const fixture = await deployVeilSwapFixture();
    const rogue = await fixture.viem.deployContract("TestERC20", ["Rogue", "RGE", 18]);
    await assert.rejects(fixture.pair.write.deposit([rogue.address, 1n]));
    await assert.rejects(fixture.pair.write.deposit([fixture.tokenA.address, (1n << 128n) + 1n]));
  });

  it("transfers confidentially, all-or-nothing, with hidden amounts", async () => {
    const fixture = await deployVeilSwapFixture();
    const [user1, user2] = fixture.wallets;
    await depositAs(fixture, user1, fixture.tokenA, 100n * ONE_A);

    // Sufficient balance: 40 A moves to user2.
    const enc40 = await encryptAs(fixture, user1, 40n * ONE_A, "uint256");
    await fixture.pair.write.confidentialTransfer([
      user2.account.address,
      fixture.tokenA.address,
      enc40.handle,
      enc40.handleProof,
    ]);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 60n * ONE_A);

    // Insufficient balance: nothing moves, no revert (no balance oracle).
    const enc999 = await encryptAs(fixture, user1, 999n * ONE_A, "uint256");
    await fixture.pair.write.confidentialTransfer([
      user2.account.address,
      fixture.tokenA.address,
      enc999.handle,
      enc999.handleProof,
    ]);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 60n * ONE_A);

    // user2 provably holds exactly 40 A (verified through the real withdraw path).
    await assertExactBalanceViaWithdraw(
      fixture,
      user2,
      fixture.tokenA,
      40n * ONE_A,
      "0x00000000000000000000000000000000000000a1"
    );
  });

  it("withdraws to any address in two steps with an on-chain verified proof", async () => {
    const fixture = await deployVeilSwapFixture();
    const [user1] = fixture.wallets;
    await depositAs(fixture, user1, fixture.tokenA, 10n * ONE_A);

    // Withdraw 7 A to a fresh address that never interacted with anything.
    const fresh = "0x00000000000000000000000000000000000000b2";
    const enc = await encryptAs(fixture, user1, 7n * ONE_A, "uint256");
    await fixture.pair.write.requestWithdraw([fixture.tokenA.address, fresh, enc.handle, enc.handleProof]);
    const requestId = await findLatestWithdrawRequestId(fixture, user1.account.address);
    const { value, decryptionProof } = await nox.publicDecrypt(requestId as any);
    assert.equal(value, 7n * ONE_A);

    await fixture.pair.write.finalizeWithdraw([requestId, decryptionProof]);
    assert.equal(await fixture.tokenA.read.balanceOf([fresh]), 7n * ONE_A);
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), 3n * ONE_A);

    // A used request cannot be replayed.
    await assert.rejects(fixture.pair.write.finalizeWithdraw([requestId, decryptionProof]));
  });

  it("burns 0 on an overdrawn withdraw instead of leaking via revert", async () => {
    const fixture = await deployVeilSwapFixture();
    const [user1] = fixture.wallets;
    await depositAs(fixture, user1, fixture.tokenA, ONE_A);

    const fresh = "0x00000000000000000000000000000000000000c3";
    const enc = await encryptAs(fixture, user1, 5n * ONE_A, "uint256");
    await fixture.pair.write.requestWithdraw([fixture.tokenA.address, fresh, enc.handle, enc.handleProof]);
    const requestId = await findLatestWithdrawRequestId(fixture, user1.account.address);
    const { value, decryptionProof } = await nox.publicDecrypt(requestId as any);
    assert.equal(value, 0n); // all-or-nothing: nothing was burnt

    await fixture.pair.write.finalizeWithdraw([requestId, decryptionProof]);
    assert.equal(await fixture.tokenA.read.balanceOf([fresh]), 0n);
    // Balance untouched.
    assert.equal(await decryptBalance(fixture, user1.account.address, fixture.tokenA), ONE_A);
  });
});
