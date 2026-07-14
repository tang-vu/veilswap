# Phase 2 — Keeper Settlement Service

## Context Links

- [plan.md](plan.md) settlement design steps 3–5; phase 1 contract ABI
- JS SDK: `@iexec-nox/handle` — `createViemHandleClient`, `publicDecrypt(handle)` → `{ value, decryptionProof }`

## Overview

P0. TypeScript keeper (keeper/) that makes epochs settle autonomously so the live demo works.

## Requirements

- `keeper/run-epoch-settlement.ts`: state machine — if epoch due (deadline passed or ≥M intents):
  read pool slot0 → derive quote → `lockEpoch(quoteNum, quoteDen)` → wait for Runner to compute
  totals → SDK `publicDecrypt` both sum handles (poll w/ backoff) → `settleEpoch(proofA, proofB)`
- Idempotent + crash-safe: derive state purely from chain (epoch phase enum), no local DB
- npm scripts: `keeper:once`, `keeper:watch` (interval loop); optional GitHub Action cron workflow
- viem wallet client from KEEPER_PRIVATE_KEY env; clear logging (epoch id, tx hashes, decrypted totals)

## Implementation Steps

1. `keeper/veilswap-contract-client.ts` — viem helpers, ABI import from hardhat artifacts
2. `keeper/run-epoch-settlement.ts` — state machine + polling publicDecrypt
3. `keeper/watch.ts` — setInterval wrapper
4. `.github/workflows/keeper-cron.yml` — every 10 min, secrets-based (optional, documented)

## Success Criteria

Against local stack (or Sepolia in phase 5): submit intents → keeper runs → epoch settles with
single router swap → balances credited. Handles empty epoch gracefully (skip or roll).

## Risk Assessment

publicDecrypt availability lag (Runner async) → poll with timeout + resume on next run;
partial failure between lock and settle → phase enum on-chain lets keeper resume mid-epoch.
