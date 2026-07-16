# VeilSwap — 4-Minute Demo Script

Two browser profiles, side by side: **Alice** (left, holds WETH) and **Bob**
(right, holds USDC). Both funded on Sepolia beforehand. Keeper running in a
visible terminal (`pnpm keeper:watch`). Etherscan tabs pre-opened on the
VeilSwapPair address and the Uniswap pool. Epoch duration: 5 minutes — start
recording right after an epoch opens.

---

### 0:00 — The hook

*Screen: Etherscan token-transfers view of any active Uniswap wallet.*

> "Every swap you've ever made is public. Your size, your direction, your
> timing, your whole portfolio — anyone can follow it, front-run it, copy it.
> This is VeilSwap: real trades on real public Uniswap liquidity, where
> observers learn nothing about you."

*Cut to the VeilSwap app: dark dashboard, epoch countdown ticking.*

### 0:30 — Deposit (Alice)

*Alice's profile.*

> "Alice deposits 0.05 WETH. This is the last thing the chain will ever see
> her do."

- Deposit 0.05 WETH → approve → deposit → tx confirms.
- Click her encrypted balance: show the raw 32-byte **handle**, then hit
  **decrypt** — the amount appears client-side only.

> "Her balance is now an encrypted handle. Only her wallet can decrypt it."

### 1:00 — Two opposing encrypted intents

*Split screen.*

- Alice: intent **WETH → USDC**, 0.05 WETH, suggested minOut. Point at the
  status line: *encrypting via TEE gateway… → submitted*.
- Bob: intent **USDC → WETH**, 50 USDC, suggested minOut.

*Open one submitIntent tx on Etherscan; show the calldata.*

> "On-chain this intent is three encrypted handles. Direction, amount, limit —
> all hidden. Even which of these two is buying and which is selling is
> secret. The dashboard shows a count: two intents. Nothing else."

### 2:00 — Settlement: the money shot

*Keeper terminal visible; countdown hits zero; keeper locks then settles.
(Alternative shot: skip the terminal and click the dashboard's own
"lock epoch" / "finalize settlement" buttons — settlement is permissionless
and the browser fetches the TEE proofs itself. Pick whichever reads better
on camera.)*

> "The epoch closes. Inside the encrypted domain, Bob's 50 USDC is matched
> directly against part of Alice's WETH — that volume never touches the public
> market. Only the leftover goes to Uniswap."

*Open the settleEpoch tx on Etherscan. Zoom on the token-transfer trace.*

> "One transaction. One aggregate swap from the VeilSwap contract to the real
> Uniswap V3 pool — the netted residual only. No user addresses, no individual
> amounts. Alice's dashboard: her USDC balance decrypts to the full fill —
> internal match plus Uniswap output, at the same guaranteed price."

### 3:00 — Private transfer + untraceable exit

- Alice transfers 10 (encrypted) USDC to Bob: *"amount hidden on-chain —
  VeilSwap doubles as a private payment rail."*
- Bob withdraws his WETH **to a brand-new empty address**: request → TEE
  decryption proof → finalize.

*Show the fresh address on Etherscan: it has exactly one incoming transfer,
from the VeilSwap contract.*

> "This wallet has no history. Nothing links it to Bob's deposit. The
> deposit-to-withdrawal trail is severed."

### 3:40 — Close

*App dashboard: settled epoch stats; then repo README.*

> "Encrypted balances on iExec Nox. Batched intents netted inside a TEE. One
> aggregate swap on unmodified public Uniswap. No admin keys, permissionless
> settlement, and every proof verified on-chain. VeilSwap — dark-pool privacy
> on public liquidity."

---

## Pre-flight checklist

- [ ] Both wallets funded: ETH for gas, Alice ≥ 0.05 WETH, Bob ≥ 50 USDC
- [ ] Fresh withdrawal address generated (never used)
- [ ] Keeper running with `KEEPER_INTERVAL_MS=15000`
- [ ] Epoch just opened (≥ 4 min of runway) and 0 pending intents
- [ ] Etherscan tabs: pair address, pool address, (later) settle tx
- [ ] App decrypt buttons tested once off-camera (gateway warm)

## Timing risks

- TEE decrypt latency at settle (keeper polls): rehearse; if > 30 s, narrate
  the pipeline using the architecture diagram.
- Sepolia congestion: raise keeper gas or pre-bump; record off-peak.
