# Phase 5 — Sepolia Deploy + Full E2E Rehearsal

## Context Links

- [plan.md](plan.md); all prior phases; docs/DEMO_SCRIPT.md

## Overview

P0. Deploy verified contracts to ETH Sepolia, run the ENTIRE demo script with two funded wallets,
record real tx hashes into README.

## Blockers (user input required)

- Funded Sepolia deployer/keeper private key + 2 demo wallet keys (~0.2 ETH total across them)
- Etherscan API key (v2) for verification

## Implementation Steps

1. Verify Uniswap addresses on-chain (router code exists, pool liquidity still present, quote sane)
2. Acquire test WETH (wrap ETH) + USDC (Circle faucet or swap on the pool) for demo wallets
3. Deploy VeilSwapPair via hardhat script; verify on Etherscan (source + constructor args)
4. Record addresses → deployments.json, README, app config
5. E2E per DEMO_SCRIPT.md: wallet A deposits WETH, wallet B deposits USDC → opposing intents
   (B smaller) → keeper settles → assert: Etherscan shows ONE router swap for residual only,
   internal match never touched chain → decrypt balances, verify pro-rata math to the wei →
   private transfer A→B → B withdraws to FRESH address
6. Negative checks: intent with impossible minOut → refunded, epoch still settles for rest
7. Paste all tx hashes into README demo-walkthrough table
8. Final: lint, tests, fresh-clone install rehearsal, commit history clean

## Success Criteria

Every DEMO_SCRIPT.md scene reproducible on Sepolia with pasted tx hashes; contract verified
(green check on Etherscan); keeper runs unattended during demo window.

## Risk Assessment

- Sepolia congestion/gas spikes → fund generously, retry logic in keeper
- Nox Sepolia stack (Runner/Gateway) latency or downtime → status page https://docs.noxprotocol.io/getting-started/status;
  if down, STOP and report (per spec: no mocking)
- Pool liquidity drained by others → 1% fee pool fallback (1252 WETH), fee tier is constructor param
