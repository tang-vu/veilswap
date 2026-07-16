# VeilSwap — iExec WTF Hackathon Build Plan

Confidential swap + payment layer on iExec Nox (ETH Sepolia) routing residual volume
through public Uniswap V3. Goal: 1st place. Production-quality, zero mocks in product.

## Architecture Reality-Check (verified 2026-07-14)

| Spec assumption | Nox reality | Adaptation |
|---|---|---|
| "TEE decrypts intents, nets, executes" as custom TEE job | Nox = fhEVM-style: Solidity ops on encrypted handles (`euint256`), executed by TEE Runner async off-chain. No custom TEE code. | Netting math written IN Solidity over handles. No `tee/` dir — confidential logic lives in `contracts/`. |
| Nox contract calls Uniswap on Sepolia | Nox deployed on ETH Sepolia 11155111, NoxCompute `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` (verified `Nox.sol:49`) | Direct call works. Same chain. |
| Settlement reveals net amount | `Nox.allowPublicDecryption(handle)` → SDK `publicDecrypt` → on-chain `Nox.publicDecrypt(handle, proof)` returns verified plaintext (view) | Two-tx settlement: `lockEpoch` → keeper decrypts totals → `settleEpoch(proofs)` |
| Uniswap V3 Sepolia liquidity | WETH/USDC 0.05% pool `0x3289680d...eff1` ~149 WETH; 1% pool ~1252 WETH (verified via RPC) | Use canonical WETH/USDC 500-fee pool. No own pool needed. |
| Counterparties hidden in transfers | No `eaddress` type; recipient is public calldata | Amounts hidden, addresses visible. Honest in threat model. Withdraw-to-fresh-address breaks linkage. |

Three pillars preserved: encrypted balances ✓, internal netting ✓, single aggregate swap on real Uniswap ✓.
Bonus: intent DIRECTION also encrypted (ebool) — observers can't even see trade side.

## Key technical facts

- Packages: `@iexec-nox/nox-protocol-contracts` (Nox.sol SDK), `@iexec-nox/nox-confidential-contracts` (ERC7984, wrapper), `@iexec-nox/handle` (JS SDK, viem client), `@iexec-nox/nox-hardhat-plugin` (local stack, Hardhat 3 + toolbox-viem, solc 0.8.35, needs Docker for tests)
- Ops: add/sub/mul/div, safeAdd/…, eq/lt/ge/…→ebool, select(ebool,a,b), Nox.transfer/mint/burn (all-or-nothing, no revert-oracle), allowThis/allow/allowTransient/allowPublicDecryption, fromExternal(handle,proof)
- #1 bug per docs: forgetting allowThis/allow after EVERY op
- No ebool and/or/not → chain `select` for AND logic
- Docs: https://docs.noxprotocol.io (llms-full.txt saved in scratchpad)
- Uniswap Sepolia: SwapRouter02 `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`, Factory `0x0227628f3F023bb0B980b67D528571c95c6DaC1c`, WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`, USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (verify router on-chain before use)

## Settlement design (final)

1. `deposit(token, amount)`: ERC20 pull + credit encrypted balance (`toEuint256`). Amount public here (unavoidable, documented).
2. `submitIntent(eDir, eAmountIn, eMinOut + proofs)`: all-or-nothing escrow debit via select-chains. Insufficient balance → amount forced to 0 (no revert leak).
3. `lockEpoch(quotePriceNum/Den)` keeper: price sanity-checked vs pool slot0 (max deviation bps). Per-intent eligibility: eMinOut ≤ escrow × worstPrice (quote × (1−slippageBps)). Eligible escrows summed per side → `allowPublicDecryption(sumWETH, sumUSDC)`. Ineligible → refunded.
4. Keeper polls SDK `publicDecrypt` for both totals → plaintexts + proofs.
5. `settleEpoch(proofA, proofB)`: verify via `Nox.publicDecrypt`. Internal match = min side at quote price. Residual → ONE Uniswap exactInputSingle with amountOutMinimum = worst-case. Distribution: out_i = escrow_i(enc) × totalOut(plain) / totalIn(plain). Dust → protocol bucket (stays in contract). Smaller side fills 100% internally at quote; larger side gets blend ≥ worst-case ≥ every included minOut. Exact, no circularity.
6. Withdraw: two-step (burn → publicDecrypt proof → ERC20 to ANY address), mirrors ERC20ToERC7984Wrapper pattern.
7. Private transfer: `Nox.transfer` between internal balances.

Leakage (documented honestly): deposit/withdraw amounts, intent count + submitter addresses,
per-epoch eligible side-totals at settlement, transfer counterparties. Hidden: intent direction,
amounts, minOut, balances, who-traded-what. k-anonymity ∝ intents/epoch.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | [Scaffold + contracts + unit tests](phase-01-scaffold-contracts-tests.md) | ✅ done — 19/19 tests green on real local Nox stack (run inside WSL; see notes) |
| 2 | [Keeper settlement service](phase-02-keeper-settlement-service.md) | ✅ done — typechecked; live run pending deployment |
| 3 | [Frontend dark-pool app](phase-03-frontend-dark-pool-app.md) | ✅ code-complete — builds clean; visual pass pending deployed contracts |
| 4 | [Docs + feedback.md](phase-04-docs-and-feedback.md) | ✅ drafted — README/ARCHITECTURE/DEMO_SCRIPT/feedback written; tx hashes pending E2E |
| 5 | [Sepolia deploy + E2E rehearsal](phase-05-deploy-and-e2e-rehearsal.md) | ✅ done 2026-07-16 — pair `0x814Cb2265c7508269501325E2BEDFD76E79D3ff6` verified; full demo flow executed on live Sepolia+Nox, all tx hashes in README. Lessons: slippageBps=300 for this volatile testnet pool (drift ~1.7%/5min); keeper gas = 2× estimate. First deployment `0x529da48b…D31f` (50bps) abandoned — its epoch #2 escrows (0.01 WETH + 100 USDC) recoverable via cancelEpoch after grace. |

## Build notes (2026-07-14)

- This machine runs Docker Engine inside WSL (no Docker Desktop) → the Nox plugin's
  named-pipe check fails on Windows. Tests run in WSL: repo synced to `~/veilswap`
  (root), `pnpm hardhat test` there. Node 22 installed in WSL for this.
- Gas (2-intent epoch, local): submit ~575k, lock ~1.09M, settle ~709k → maxIntents=8 at deploy.
- Key SDK finding (in feedback.md #9): input-proof owner comes from `getAddresses()[0]`,
  not the bound account — wrap wallet clients so `getAddresses()` returns only the
  bound account (done in tests + app).

Dependencies: 1 → 2 → 5; 3 parallel after 1; 4 incremental throughout.
feedback.md seeded in phase 1, updated every phase (judged deliverable).

## Blockers needing user input (flagged early)

- Funded Sepolia private key(s) for deploy + keeper + 2 demo wallets (needed at phase 5)
- Etherscan API key for verification (needed at phase 5)
- Docker Desktop running locally for Nox hardhat tests (phase 1 — will detect and report)
