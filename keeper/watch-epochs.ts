import { createKeeperContext } from "./veilswap-contract-client.js";
import { runSettlementPass } from "./run-epoch-settlement.js";

/**
 * Long-running keeper loop: runs a settlement pass every KEEPER_INTERVAL_MS
 * (default 30s). Errors are logged and retried on the next tick — state lives
 * on-chain, so no pass depends on the previous one succeeding.
 */
const intervalMs = Number(process.env.KEEPER_INTERVAL_MS ?? 30_000);

const ctx = await createKeeperContext();
console.log(`[keeper] watching pair ${ctx.pairAddress} as ${ctx.account.address} every ${intervalMs / 1000}s`);

for (;;) {
  try {
    await runSettlementPass(ctx);
  } catch (error) {
    console.error(`[keeper] pass failed (retrying next tick): ${(error as Error).message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
