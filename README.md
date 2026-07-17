# VeilSwap

**Dark-pool privacy on public liquidity.** VeilSwap is a confidential swap and
payment layer built on [iExec Nox](https://docs.noxprotocol.io) confidential
smart contracts. Deposit WETH or USDC and your activity disappears: balances
become encrypted handles, swap intents hide their **direction, size and limit**
inside Intel TDX enclaves, and opposing flow is netted entirely off the public
market. Each epoch, only the net residual executes as **one aggregate swap** on
the real, unmodified Uniswap V3 pool on Ethereum Sepolia.

![VeilSwap dashboard](docs/assets/veilswap-dashboard.png)

**Try it live: [tang-vu.github.io/veilswap](https://tang-vu.github.io/veilswap/)** — connect any
Sepolia wallet; the app can wrap faucet ETH into WETH for you, and even lets you drive epoch
settlement yourself (it's permissionless — the dashboard doubles as a keeper).

### Don't trust the pitch — flip the switch

The dashboard has one control that makes the whole claim falsifiable: **chain view**. Flip it and
the app re-renders as an *observer*, showing only what an indexer can actually pull off Sepolia.
Encrypted values collapse to their real Nox handle, and the observer's ledger decodes the pool's
live event log — no wallet, no privileges, nothing redacted by the UI. The fields you'd want most
simply aren't there: `IntentSubmitted` carries an epoch, an index and an address, and **no
direction, no size, no limit**. What *is* legible is labelled as leakage the protocol admits to.

![VeilSwap chain view — the observer's ledger](docs/assets/veilswap-chain-view.png)

Observers see a contract trade with Uniswap once per epoch. They never see who
traded, how much, or which way — and volume that nets internally never touches
the public chain at all. Encrypted balances double as a private payment rail
(hidden-amount transfers), and withdrawals can exit to any fresh address,
severing the deposit → withdrawal link. The protocol is **ownerless**: epoch
settlement is permissionless, the reference price is read from the pool itself,
and every decrypted value carries a Nox proof verified on-chain. A keeper adds
liveness, never authority.

```mermaid
flowchart LR
    A["Alice\nsells WETH (encrypted)"] -->|encrypted intent| VS
    B["Bob\nsells USDC (encrypted)"] -->|encrypted intent| VS
    VS["VeilSwapPair\nencrypted ledger · epoch batching"]
    VS <-->|handle ops| NOX["Nox protocol\nIntel TDX enclaves"]
    VS -->|"ONE net residual swap / epoch"| UNI["Uniswap V3\npublic WETH/USDC pool"]
    VS -.->|"internally netted volume\n(never hits the chain)"| VS
```

## How the privacy works

1. **Encrypted state** — balances, intent fields and escrows are Nox handles
   (`euint256`/`ebool`). Plaintext exists only inside attested TDX enclaves and
   in the owner's browser.
2. **Batching + netting** — each epoch's intents are eligibility-checked and
   summed *in the encrypted domain*. Opposing flow cross-fills internally at
   the epoch price; only two aggregate side totals are ever revealed (with
   on-chain verified decryption proofs), because the residual swap needs a
   plaintext size.
3. **k-anonymity** — an observer learns only "k intents; these side totals".
   Every participant hides among the k submitters, and per-intent `minOut` is
   still enforced exactly via the shared worst-case bound used as the Uniswap
   `amountOutMinimum`. Privacy scales with batch size — see the full
   [threat model](docs/ARCHITECTURE.md#threat-model--what-is-hidden-from-whom).

## Repository layout

```
contracts/   VeilSwapPair + encrypted ledger + pure netting lib (Solidity 0.8.35)
test/        19 tests against a real local Nox stack (TEE runner in Docker)
keeper/      permissionless settlement service (lock → publicDecrypt → settle)
app/         Vite + React + wagmi + RainbowKit dark-pool frontend
scripts/     deploy + ABI export
docs/        ARCHITECTURE.md · DEMO_SCRIPT.md
feedback.md  honest iExec Nox developer-experience feedback (judged deliverable)
```

## Quickstart (fresh clone)

Prereqs: Node 22+, pnpm 9+, Docker running (for the local Nox test stack).

```sh
pnpm install
pnpm compile          # solc 0.8.35, viaIR
pnpm test             # boots the full local Nox stack in Docker — first run pulls images
```

> **Windows note:** the Nox hardhat plugin detects Docker via the
> `docker_engine` named pipe. With Docker Desktop this just works; if your
> Docker engine lives inside WSL, run the tests from a WSL shell instead.

### Frontend

```sh
cd app && pnpm install && pnpm dev     # http://localhost:5173 (Sepolia)
```

### Deploy to Sepolia

```sh
cp .env.example .env                   # fill PRIVATE_KEY, ETHERSCAN_API_KEY
pnpm deploy:sepolia                    # deploys against real Uniswap V3, updates deployments.json
pnpm tsx scripts/export-abi-to-app.ts  # sync ABI + addresses into the app
pnpm hardhat verify --network sepolia <address> <args…>   # printed by the deploy script
```

### Keeper

```sh
# .env: KEEPER_PRIVATE_KEY, VEILSWAP_PAIR_ADDRESS
pnpm keeper:watch      # or keeper:once / the GitHub Action cron (.github/workflows)
```

## Deployed addresses (Ethereum Sepolia)

| Contract | Address |
|---|---|
| VeilSwapPair (verified) | [`0x814Cb2265c7508269501325E2BEDFD76E79D3ff6`](https://sepolia.etherscan.io/address/0x814Cb2265c7508269501325E2BEDFD76E79D3ff6#code) |
| WETH | [`0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`](https://sepolia.etherscan.io/address/0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14) |
| USDC | [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |
| Uniswap V3 WETH/USDC 0.05% pool | [`0x3289680dd4d6c10bb19b899729cda5eef58aeff1`](https://sepolia.etherscan.io/address/0x3289680dd4d6c10bb19b899729cda5eef58aeff1) |
| Uniswap SwapRouter02 | [`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`](https://sepolia.etherscan.io/address/0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E) |
| NoxCompute | [`0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF`](https://sepolia.etherscan.io/address/0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF) |

Machine-readable copy in [`deployments.json`](deployments.json).

## Demo walkthrough (real Sepolia transactions)

Follows [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — every hash below is a real
Sepolia transaction from the end-to-end rehearsal (epoch #1 on the deployed
pair). Alice sold 0.01 WETH, Bob sold 100 USDC: Bob's side was matched **fully
internally** at the lock price; only the 0.00578 WETH residual ever touched the
public market, in one aggregate swap. Alice's fill decrypted to 236.95 USDC,
Bob's to exactly 0.004218864278420221 WETH.

| Step | Tx |
|---|---|
| Alice deposits 0.01 WETH ([approve](https://sepolia.etherscan.io/tx/0x232a65cbb64ff63679bb2bf0b69f1626f9a6914df11b6e40710c3f8e7650a9c0)) | [`0x6c58ed97…`](https://sepolia.etherscan.io/tx/0x6c58ed9760de3c6858640d1b95ef928a3d4ecd603d84aae063e5c349114ab967) |
| Bob deposits 100 USDC ([approve](https://sepolia.etherscan.io/tx/0xd50aaf5d439a08e84f26dcc267e165dea6c24ab8651915f55e9f503d4dddec50)) | [`0xb8539dde…`](https://sepolia.etherscan.io/tx/0xb8539ddeb3f36729615da1d3eb99545ac59677341cf8ab5e9591a3f3bc78ba5a) |
| Alice's encrypted intent (direction/size/limit all hidden) | [`0xd069454e…`](https://sepolia.etherscan.io/tx/0xd069454ed5bfceda467dc773c034f1c983d68e79d03278f6785ddaf2d380a297) |
| Bob's encrypted intent (opposing side, indistinguishable) | [`0xddab4161…`](https://sepolia.etherscan.io/tx/0xddab4161faf5cb564627eebe5233380dfbe7098ba15c13cde2dbd1c7c28d41e8) |
| Epoch lock — encrypted eligibility + side totals | [`0x138f457a…`](https://sepolia.etherscan.io/tx/0x138f457a640ef8c45c571db64380f533a28ba3653fbc3587585d098db648a423) |
| **Settlement — ONE aggregate Uniswap swap (0.00578 WETH residual)** | [`0xbb521325…`](https://sepolia.etherscan.io/tx/0xbb521325a307589d3a6a3c870b986dc0652b2c6f1820167214e3a432d992d1a2) |
| Private transfer Alice → Bob (amount hidden on-chain) | [`0x0bf9f01a…`](https://sepolia.etherscan.io/tx/0x0bf9f01a0ec77db392a5ba42ce4ff031882a410e8aba9031d0010779c59642a3) |
| Withdrawal request to a fresh address | [`0x11210d67…`](https://sepolia.etherscan.io/tx/0x11210d67ec14e7f974f7e89401a65f2c530ea72c3ad078e29a2a330c53058250) |
| Withdrawal finalized — [fresh address](https://sepolia.etherscan.io/address/0x867b5Ee47B88c26F59aFD0714D803f6df6D71582) holds the WETH, link severed | [`0x5fae443c…`](https://sepolia.etherscan.io/tx/0x5fae443c1a9fbe2990331020fe5b85b13a2c2eea5971182fcf4a76f3baaded05) |

Reproduce it yourself: `pnpm tsx scripts/e2e-demo-rehearsal.ts` (needs the
funded wallets from `.env`).

## Provenance

Everything in this repository was designed and built from scratch during the
iExec WTF Hackathon Summer Edition (July 2026). External code enters only as
standard dependencies: the iExec Nox packages, OpenZeppelin, Uniswap's deployed
contracts (used on-chain, unmodified), and the usual React/viem toolchain.

## Tests

19 tests, all running against the **real** local Nox stack (gateway, KMS, TEE
runner — no mocked encryption): exact netting math to the wei, all-or-nothing
ledger semantics, minOut exclusion + refund, fully-netted epochs (zero public
swaps), empty-epoch rollover, and the cancel escape hatch.

```
19 passing
```
