# Phase 3 — Frontend Dark-Pool App

## Context Links

- [plan.md](plan.md); phase 1 ABI; JS SDK `@iexec-nox/handle` viem client
- SDK usage: `encryptInput(value, 'uint256'|'bool', CONTRACT_ADDRESS)` → `{handle, handleProof}`;
  `decrypt(handle)` for own balances (EIP-712 sig, no gas)

## Overview

P0. Vite + React + TS + wagmi/viem + RainbowKit in `app/`. Dark minimal "dark pool" aesthetic.
UX is explicit judging criterion — no placeholders, no dead buttons.

## Requirements (panels)

1. Connect wallet (RainbowKit, Sepolia only)
2. Deposit: token select (WETH/USDC), approve + deposit flow with tx status
3. Encrypted balances: handle shown obfuscated → "Decrypt" button reveals via SDK `decrypt` (client-side)
4. Swap intent: direction toggle, amount, minOut (auto-suggest from pool quote ± slippage), submit
   encrypts all three via `encryptInput`; pending-intent status chip
5. Epoch dashboard: countdown to deadline, pending intent COUNT (never amounts), phase indicator,
   last settlement tx → Etherscan link (THE money shot: one aggregate swap)
6. Private transfer: recipient + amount (encrypted)
7. Withdraw: two-step UI (request → auto-poll → finalize), recipient = any address (fresh-wallet story)

## Architecture

- `app/src/lib/` — nox-handle-client.ts, veilswap-contract.ts (ABI + addresses from deployments.json), uniswap-quote.ts
- `app/src/components/` — one component per panel, kebab-case files, ≤200 lines
- `app/src/hooks/` — use-encrypted-balance.ts, use-epoch-state.ts (polling), use-intent-submission.ts
- State: wagmi + tanstack-query only (YAGNI: no redux)

## Design

Dark bg (#0a0a0f range), monospace numerals, subtle green/violet accents, scanline/veil motif,
generous spacing. No AI-slop gradients. Skeleton loaders for chain reads.

## Success Criteria

Full flow clickable against deployed Sepolia contracts with real txs; every button functional;
decrypt-own-balance works; epoch dashboard live-updates.
