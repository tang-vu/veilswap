# VeilSwap — Dark-Pool Privacy on Public Liquidity

**A confidential swap and payment layer on iExec Nox. Encrypted intents, internal
netting, and exactly one aggregate swap per epoch on the real, unmodified Uniswap
V3 pool — deployed and running on Ethereum Sepolia.**

📺 **Demo (2 min):** https://youtu.be/NQwBM2qSafI
🔗 **Try it live:** https://tang-vu.github.io/veilswap/
💻 **Code:** https://github.com/tang-vu/veilswap
📜 **Verified contract:** [`0x814Cb2265c7508269501325E2BEDFD76E79D3ff6`](https://sepolia.etherscan.io/address/0x814Cb2265c7508269501325E2BEDFD76E79D3ff6#code)

![VeilSwap dashboard](https://raw.githubusercontent.com/tang-vu/veilswap/main/docs/assets/veilswap-dashboard.png)

---

## The problem

Every trade on a public AMM is a broadcast. Your size, your direction, your
timing and your whole position history are permanently legible to anyone with an
RPC endpoint. That is not a privacy nicety — it is an economic attack surface:

- **Traders** get front-run and sandwiched.
- **Market makers** have their inventory read straight off the chain.
- **Treasuries and funds** cannot rebalance without telegraphing intent.
- **Anyone worth copying** is taxed by copy bots.

Traditional finance solved this decades ago with dark pools. On-chain, the same
order is still a public announcement.

Existing answers each surrender something:

| Approach | What it gives up |
|---|---|
| Private mempools | Only *delays* disclosure — the trade still lands in the clear |
| Mixers | Break the address link, but the trade itself stays public |
| App-specific privacy chains | Buy confidentiality by abandoning the liquidity — you trade privately into thin markets |

## What VeilSwap does

VeilSwap **keeps the liquidity and hides the trader**.

1. **Encrypted state.** Balances, intent direction, size and limit are Nox
   handles (`euint256` / `ebool`). Plaintext exists only inside attested Intel
   TDX enclaves and in the owner's browser.
2. **Batching + netting.** Each epoch's intents are eligibility-checked and
   summed *in the encrypted domain*. Opposing flow cross-fills internally at the
   epoch price — **that volume never touches the public market at all.**
3. **One aggregate swap.** Only the net residual executes on the real,
   unmodified Uniswap V3 WETH/USDC pool, from the pool contract. No user
   addresses. No individual sizes.
4. **Exit anywhere.** Withdraw to a fresh address and the deposit → withdrawal
   link is severed.

Observers see a contract trade with Uniswap once per epoch. They never learn who
traded, how much, or which way. Bonus beyond the original spec: the intent
**direction** is encrypted too, so you can't even tell buyers from sellers.

The protocol is **ownerless**: epoch settlement is permissionless, the reference
price is read from the pool itself, and every decrypted value carries a Nox proof
verified on-chain. A keeper adds liveness, never authority — the dashboard itself
doubles as a keeper, so any visitor can drive settlement.

## Don't trust the pitch — flip the switch

Privacy claims are cheap. The live app ships a **chain view** toggle: flip it and
the dashboard re-renders as an *observer*, showing only what an indexer can
actually pull off Sepolia. Encrypted values collapse to their real Nox handle,
and the observer's ledger decodes the pool's live event log — no wallet, no
privileges, nothing redacted by the UI.

![Chain view — the observer's ledger](https://raw.githubusercontent.com/tang-vu/veilswap/main/docs/assets/veilswap-chain-view.png)

The fields you'd want most simply are not there:

- `IntentSubmitted` → an epoch, an index, an address. **No direction. No size. No limit.**
- `ConfidentialTransfer` → sender, recipient, token. **No amount.**
- `EpochLocked` → the side totals, emitted as **ciphertext handles**.

And where the protocol *does* leak, the ledger labels it as leakage rather than
hiding it.

## Real Sepolia transactions

Every hash below is a real end-to-end run on the deployed pair. Alice sold 0.01
WETH, Bob sold 100 USDC: **Bob's side matched fully internally** at the lock
price, and only the 0.00578 WETH residual ever reached the public market.

| Step | Tx |
|---|---|
| Alice's encrypted intent (direction/size/limit hidden) | [`0xd069454e…`](https://sepolia.etherscan.io/tx/0xd069454ed5bfceda467dc773c034f1c983d68e79d03278f6785ddaf2d380a297) |
| Bob's encrypted intent (opposing side, indistinguishable) | [`0xddab4161…`](https://sepolia.etherscan.io/tx/0xddab4161faf5cb564627eebe5233380dfbe7098ba15c13cde2dbd1c7c28d41e8) |
| Epoch lock — encrypted eligibility + side totals | [`0x138f457a…`](https://sepolia.etherscan.io/tx/0x138f457a640ef8c45c571db64380f533a28ba3653fbc3587585d098db648a423) |
| **Settlement — ONE aggregate Uniswap swap** | [`0xbb521325…`](https://sepolia.etherscan.io/tx/0xbb521325a307589d3a6a3c870b986dc0652b2c6f1820167214e3a432d992d1a2) |
| Private transfer Alice → Bob (amount hidden) | [`0x0bf9f01a…`](https://sepolia.etherscan.io/tx/0x0bf9f01a0ec77db392a5ba42ce4ff031882a410e8aba9031d0010779c59642a3) |
| Withdrawal to a fresh address — link severed | [`0x5fae443c…`](https://sepolia.etherscan.io/tx/0x5fae443c1a9fbe2990331020fe5b85b13a2c2eea5971182fcf4a76f3baaded05) |

## How it works on iExec Nox

Nox is fhEVM-style: Solidity operations over encrypted handles, executed
asynchronously by a TEE runner. There is no custom TEE binary — **the netting
math is written in Solidity, over ciphertext.**

```
deposit(token, amount)          ERC20 pull, credit encrypted balance
submitIntent(eDir, eAmt, eMin)  all-or-nothing escrow debit via select-chains
                                (insufficient balance forces amount to 0 —
                                 no revert, so nothing leaks)
lockEpoch(price)                price sanity-checked vs pool slot0; per-intent
                                eligibility in the encrypted domain; eligible
                                escrows summed per side, then
                                allowPublicDecryption(sumA, sumB)
settleEpoch(proofA, proofB)     proofs verified on-chain via Nox.publicDecrypt;
                                internal match at quote price; residual → ONE
                                Uniswap exactInputSingle
```

Settlement needs a plaintext size for the residual, so exactly two aggregate
side-totals are revealed per epoch — with on-chain verified decryption proofs.
Nothing else is.

**Why this is hard:** there is no `ebool` and/or/not, so every conditional is a
chained `select`. There is no revert oracle, so insufficient balance has to
silently clamp to zero instead of reverting. And every single operation needs an
explicit `allow` afterwards.

## Honest boundaries

We publish what leaks, because a privacy protocol that oversells itself is worse
than one that doesn't exist:

- **Public:** deposit/withdraw amounts, intent count and submitter addresses,
  per-epoch eligible side totals at settlement, transfer counterparties.
- **Hidden:** intent direction, amounts, limits, balances, who-traded-what.
- **k-anonymity:** each participant hides among the k intents in the batch, so
  privacy scales with batch size. A 1-intent epoch protects little — this is
  stated plainly rather than glossed over.
- Nox has no `eaddress` type, so recipients are public calldata. Amounts are
  hidden; addresses are not. Withdrawing to a fresh address is what breaks
  linkage.

Full threat model: [docs/ARCHITECTURE.md](https://github.com/tang-vu/veilswap/blob/main/docs/ARCHITECTURE.md#threat-model--what-is-hidden-from-whom)

## Tests

**19 tests, all against a real local Nox stack** (gateway, KMS, TEE runner — no
mocked encryption): exact netting math to the wei, all-or-nothing ledger
semantics, minOut exclusion + refund, fully-netted epochs (zero public swaps),
empty-epoch rollover, and the cancel escape hatch.

## Try it yourself

1. Open https://tang-vu.github.io/veilswap/ and connect any Sepolia wallet.
2. Grab Sepolia ETH from a faucet — the app wraps it to WETH for you.
3. Deposit, then submit an encrypted intent.
4. Flip **chain view** and confirm the app is telling the truth.
5. Drive settlement yourself — it's permissionless.

## Deliverables

- **Live dApp:** https://tang-vu.github.io/veilswap/ (GitHub Pages, auto-deployed)
- **Verified contract:** [`0x814Cb2…3ff6`](https://sepolia.etherscan.io/address/0x814Cb2265c7508269501325E2BEDFD76E79D3ff6#code)
- **Permissionless keeper:** service + GitHub Actions cron, settling live epochs
- **`feedback.md`:** honest iExec Nox developer-experience feedback — the real
  friction we hit, including an input-proof ownership gotcha where the proof
  owner comes from `getAddresses()[0]` rather than the bound account.

## Provenance

Everything in this repository was designed and built from scratch during the
iExec WTF Hackathon Summer Edition (July 2026). External code enters only as
standard dependencies: the iExec Nox packages, OpenZeppelin, Uniswap's deployed
contracts (used on-chain, unmodified), and the usual React/viem toolchain.
