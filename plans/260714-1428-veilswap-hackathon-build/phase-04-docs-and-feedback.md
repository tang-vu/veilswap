# Phase 4 — Docs + feedback.md (incremental, judged deliverables)

## Context Links

- [plan.md](plan.md) leakage model section (source for threat model)

## Overview

P0 (judges grade README, docs, feedback.md explicitly). Written incrementally; this phase = final polish pass.

## Deliverables

- `README.md`: 2–3 punchy paragraphs, mermaid architecture diagram, privacy explainer
  (netting + batching + k-anonymity), fresh-clone install/run/deploy, deployed addresses table,
  demo walkthrough, real tx hashes from phase 5 rehearsal
- `feedback.md` (repo root): honest Nox DX feedback, incremental since phase 1. Already collected:
  docs URL redirect (iex.ec → noxprotocol.io), `nox-hardhat-starter` repo 404 (starter actually lives
  in nox-hardhat-plugin/packages/example-project), networks page data client-rendered (invisible to
  llms-full.txt/AI tools), protocol-contracts repo unclonable on Windows (ignition build-info
  filenames > 260 chars), no ebool and/or/not primitives, no eaddress type
- `docs/ARCHITECTURE.md`: contract + handle flow, epoch lifecycle state machine (mermaid),
  threat model table (hidden vs leaked per actor), k-anonymity note, keeper trust = liveness-only
- `docs/DEMO_SCRIPT.md`: timed 4-min script per spec (0:00 hook / 0:30 deposit / 1:00 two profiles
  opposing intents / 2:00 settlement + Etherscan single-swap / 3:00 transfer + fresh-address
  withdraw / 3:40 close)
- `deployments.json`: chain id, all addresses, pool, router

## Success Criteria

Fresh-clone instructions verified by actually following them; every address/tx hash real;
feedback.md specific (file/URL-level, with suggested fixes) not generic praise.
