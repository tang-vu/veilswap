# iExec Nox — Developer Feedback from Building VeilSwap

Honest, specific notes collected *while* building a confidential batch-swap protocol
(encrypted balances + intents, TEE-side netting, aggregate settlement on Uniswap V3
Sepolia). Ordered roughly by impact. Updated incrementally throughout the build.

## What was genuinely good

- **The mental model is right.** "Write normal Solidity over `euint256` handles, the
  runner computes off-chain" meant our entire netting engine is plain Solidity — no
  custom TEE payload, no attestation plumbing on our side. We went from spec to a
  compiling confidential DEX engine in one day.
- **`Nox.publicDecrypt(handle, proof)` as an on-chain view is a killer primitive.**
  It let us build trust-minimized two-phase settlement (lock → decrypt totals off-chain
  → settle with proofs) with keeper-as-liveness-only. The `ERC20ToERC7984Wrapper`
  two-step unwrap was a perfect reference implementation to learn the pattern from.
- **All-or-nothing token ops (`Nox.transfer`/`safeSub` + `select`) are well designed** —
  the docs explicitly explaining the "revert = binary oracle" trap saved us from
  designing that bug in.
- **The Hardhat plugin's `nox` test helper** (`encryptInput`/`decrypt`/`publicDecrypt`
  against a real local stack in Docker) is exactly what a protocol team needs: our CI
  tests exercise the true encryption pipeline, not mocks.
- **`llms-full.txt` on the docs site** made the whole documentation ingestible by AI
  tooling in one fetch. More projects should do this.

## Friction encountered (with suggested fixes)

1. **Stale entry-point URLs.** `docs.iex.ec/nox-protocol/...` 308-redirects to
   `docs.noxprotocol.io`, and the `iExec-Nox/nox-hardhat-starter` repo referenced in
   early materials does not exist (404). The actual starter lives at
   `nox-hardhat-plugin/packages/example-project`. → Publish a real starter repo or fix
   the references; a 404 on the very first clone is a rough opening.
2. **The Networks page data is invisible to non-browser clients.** The chain table
   (NoxCompute addresses, RPCs, faucets) is client-rendered, so it is absent from
   `networks.md` and `llms-full.txt`. We had to recover the Sepolia address from code
   comments in the JS-SDK examples and `Nox.sol` itself. → Render the table as static
   markdown; it is the single most important page for wiring a dApp.
3. **`nox-protocol-contracts` cannot be cloned on Windows** — filenames under
   `ignition/deployments/*/build-info/` exceed MAX_PATH, so checkout fails
   (`Filename too long`). → Shorten artifact names or drop deployment build-info from
   the repo.
4. **No boolean combinators on `ebool`** (`and`/`or`/`not`). Composing conditions
   (e.g. "direction AND sufficient balance") forces nested `select` chains that cost
   an extra op each and read poorly. → `Nox.and(ebool, ebool)` would remove a whole
   class of awkwardness.
5. **No `eaddress` type.** Our private-transfer counterparties are necessarily public
   calldata; several designs (hidden recipients, stealth intents) are blocked on this.
6. **No `select` overload for `ebool` values** — you cannot pick between two encrypted
   booleans, only between numeric types, which pushes flag logic into `euint256` 0/1
   representations.
7. **pnpm 11's build-script gate isn't documented in the setup guide.** First
   `hardhat test` after install fails until `esbuild` is allow-listed
   (`allowBuilds` in `pnpm-workspace.yaml`). One sentence in the Hardhat guide would
   save the churn (the guide recommends pnpm).
8. **`Stack too deep` arrives fast.** A loop doing ~14 Nox ops per iteration (netting
   eligibility) blew the stack immediately; `viaIR: true` is effectively mandatory for
   non-trivial confidential contracts. → Mention it in the Hardhat guide's config
   snippet.
9. **Input proofs are owner-bound, but nothing documents it — and the viem
   adapter picks the wrong owner on multi-account providers.** `encryptInput`
   sends `owner = getAddresses()[0]` (`ViemBlockchainService`), while the EIP-712
   request is signed with `walletClient.account`. Against a Hardhat node,
   `eth_accounts` returns all 20 unlocked accounts with account #0 first, so
   every proof names account #0 as owner no matter which wallet encrypts; the
   gateway accepts the mismatch and the failure only surfaces later on-chain as
   `Owner mismatch` inside an *unrecognized custom error* viem can't decode (we
   read the ASCII out of raw return data). → Use `walletClient.account` as the
   owner, have the gateway reject `owner != signer`, document the owner binding
   on the `encryptInput`/`fromExternal` pages, and export the NoxCompute error
   ABI so clients can decode reverts. Workaround we ship: wrap the wallet so
   `getAddresses()` returns only the bound account.
10. **Handle branded types vs raw `bytes32`.** Contract views return handles as plain
   hex through viem, but SDK methods want `Handle<T>` branded types — every read→decrypt
   round-trip needs an `as` cast. → Export a `toHandle<T>(hex)` helper from
   `@iexec-nox/handle`.

## Unresolved questions we'd love guidance on

- Expected end-to-end latency budget on Sepolia between emitting compute events and
  `publicDecrypt` availability (drives our keeper polling strategy and epoch length).
- Gas cost model per NoxCompute op — is there a table? We calibrate
  `maxIntentsPerEpoch` empirically from local-stack measurements, but published
  numbers per primitive would let teams size batches analytically.
