import { createKeeperContext } from "./veilswap-contract-client.js";
import { runSettlementPass } from "./run-epoch-settlement.js";

/** Single settlement pass — used by `pnpm keeper:once` and the GitHub Action cron. */
const ctx = await createKeeperContext();
console.log(`[keeper] ${ctx.account.address} → pair ${ctx.pairAddress} on ${ctx.chain.name}`);
await runSettlementPass(ctx);
