import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Generates fresh demo wallets for the Sepolia E2E rehearsal and fills them
 * into .env — only for slots that are missing or empty, so existing values are
 * never overwritten. Prints ADDRESSES ONLY; private keys go straight to .env
 * (gitignored).
 *
 * Roles:
 *   PRIVATE_KEY         deployer (also default keeper)
 *   KEEPER_PRIVATE_KEY  keeper (defaults to the deployer key)
 *   ALICE_PRIVATE_KEY   demo user A (sells WETH)
 *   BOB_PRIVATE_KEY     demo user B (sells USDC)
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const env = new Map<string, string>();
for (const line of lines) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2]);
}

const created: string[] = [];
function ensureKey(name: string, fallbackTo?: string): void {
  if (env.get(name)) return; // never overwrite an existing non-empty value
  if (fallbackTo && env.get(fallbackTo)) {
    env.set(name, env.get(fallbackTo)!);
    created.push(`${name} = reuses ${fallbackTo}`);
    return;
  }
  const key = generatePrivateKey();
  env.set(name, key);
  created.push(`${name} → ${privateKeyToAccount(key).address}`);
}

ensureKey("PRIVATE_KEY");
ensureKey("KEEPER_PRIVATE_KEY", "PRIVATE_KEY");
ensureKey("ALICE_PRIVATE_KEY");
ensureKey("BOB_PRIVATE_KEY");
if (!env.has("SEPOLIA_RPC_URL")) env.set("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com");
if (!env.has("ETHERSCAN_API_KEY")) env.set("ETHERSCAN_API_KEY", "");
if (!env.has("VEILSWAP_PAIR_ADDRESS")) env.set("VEILSWAP_PAIR_ADDRESS", "");

writeFileSync(envPath, [...env.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

console.log(`.env updated (${created.length} slots filled):`);
for (const line of created) console.log(`  ${line}`);
console.log("\nAddresses to fund with Sepolia ETH:");
for (const name of ["PRIVATE_KEY", "ALICE_PRIVATE_KEY", "BOB_PRIVATE_KEY"] as const) {
  const key = env.get(name);
  if (key) console.log(`  ${name.padEnd(18)} ${privateKeyToAccount(key as `0x${string}`).address}`);
}
