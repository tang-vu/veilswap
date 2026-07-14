# Phase 1 — Scaffold + Contracts + Unit Tests

## Context Links

- Plan: [plan.md](plan.md) (architecture reality-check + settlement design — read first)
- Reference project: scratchpad `nox-hardhat-plugin/packages/example-project` (hardhat.config, package.json patterns)
- Reference wrapper: scratchpad `nox-confidential-contracts/contracts/token/extensions/ERC20ToERC7984WrapperBase.sol` (two-step unwrap + `Nox.publicDecrypt` pattern)
- Docs dump: scratchpad `nox-docs-full.md`

## Overview

Priority: P0. Status: pending.
Hardhat 3 project (toolbox-viem + nox plugin, solc 0.8.35), VeilSwap contracts, full unit tests.

## Key Insights

- Every Nox op result needs `Nox.allowThis` (+ `Nox.allow(user)` for user-readable handles) or handle is lost next tx
- All-or-nothing semantics (`Nox.transfer`) prevent revert-oracles; NEVER branch/revert on encrypted conditions
- No ebool AND → chained `select`
- `Nox.publicDecrypt(handle, proof)` is view; settlement tx2 verifies keeper-supplied proofs
- Tests run against local Docker Nox stack (chainId 31337); Uniswap absent locally → minimal `TestSwapRouter` + `TestERC20` fixtures for unit tests (real router used on Sepolia; product has zero mocks)

## Requirements

Functional: deposit, submitIntent (encrypted dir/amount/minOut), lockEpoch, settleEpoch,
requestWithdraw/finalizeWithdraw (to any address), confidentialTransfer, epoch views for UI
(epoch id, deadline, intent count, last settlement).
Non-functional: reentrancy guards, CEI, bounded loops (MAX_INTENTS_PER_EPOCH), files ≤200 lines
via module split, NatSpec on all public functions.

## Architecture

Contracts (contracts/):
- `VeilSwapPair.sol` — main entry: epochs, intents, settlement orchestration
- `VeilSwapBalances.sol` — abstract: encrypted balance ledger (deposit/withdraw/transfer)
- `VeilSwapEpochLib.sol` — pure lib: plaintext netting math (match/residual/pro-rata) — unit-testable without TEE
- `interfaces/ISwapRouter02Minimal.sol` — minimal Uniswap interface (exactInputSingle)
- `test-fixtures/TestERC20.sol`, `test-fixtures/TestSwapRouter.sol` — local-chain test doubles only

## Related Code Files

Create: above + `hardhat.config.ts`, `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`,
`test/veilswap-balances.test.ts`, `test/veilswap-epoch-lifecycle.test.ts`, `test/veilswap-netting-math.test.ts`,
`deploy/` scripts (used in phase 5), seed `feedback.md`.

## Implementation Steps

1. `git init` structure, package.json (pnpm), hardhat.config.ts mirroring example-project + sepolia network
2. Detect Docker availability; report if missing (tests blocked → note, continue coding)
3. VeilSwapEpochLib (pure math) + tests first — netting/pro-rata/dust exactness
4. VeilSwapBalances: deposit (ERC20 pull + toEuint256 mint), two-step withdraw, Nox.transfer private transfer
5. VeilSwapPair: intent struct (ebool dir, euint256 amountIn, euint256 minOut, address owner, epoch id),
   submitIntent escrow via select-chains, lockEpoch eligibility + sums + allowPublicDecryption,
   settleEpoch (publicDecrypt totals → EpochLib math → router.exactInputSingle → pro-rata credit loop)
6. Edge cases: empty epoch, single intent, all-netted (residual 0 → skip router), all-ineligible, minOut refund
7. Compile clean; run tests if Docker present

## Todo List

- [ ] Scaffold + config compiles
- [ ] EpochLib + math tests green
- [ ] Balances module + tests
- [ ] Pair intents/settlement + tests
- [ ] Edge-case tests green
- [ ] feedback.md seeded with research-phase friction

## Success Criteria

`pnpm hardhat compile` zero errors; all tests pass on local Nox stack (or documented Docker blocker);
netting math exact to 1 wei with dust accounted.

## Risk Assessment

- Gas per Nox op unknown → measure in tests; cap MAX_INTENTS_PER_EPOCH accordingly (start 16)
- euint256 mul overflow in pro-rata → enforce MAX_DEPOSIT (1e30) invariant
- Nox local stack flaky on Windows/Docker → fallback: skipTestOverride + EpochLib pure tests + Sepolia integration in phase 5

## Security Considerations

Reentrancy guards on deposit/finalizeWithdraw/settleEpoch; CEI ordering; price deviation bound on
lockEpoch quote vs pool slot0; keeper role = liveness only (cannot steal/forge — proofs verified on-chain).

## Next Steps

Phase 2 keeper consumes contract ABI + epoch state machine.
