import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import type { WalletClient } from "viem";

/**
 * Per-account Nox Handle SDK client. Input proofs are bound to the encrypting
 * wallet, so the client must always be created from the *connected* wallet.
 * The SDK ships built-in gateway/subgraph config for Sepolia (11155111).
 */
const clients = new Map<string, HandleClient>();

export async function getHandleClient(walletClient: WalletClient): Promise<HandleClient> {
  const key = walletClient.account?.address.toLowerCase() ?? "unknown";
  let client = clients.get(key);
  if (!client) {
    // The SDK derives the input owner from `getAddresses()[0]`; pin it to the
    // bound account so proofs always name the sender (multi-account providers
    // may order the list differently).
    const account = walletClient.account;
    const boundWallet = account
      ? ({ ...walletClient, getAddresses: async () => [account.address] } as WalletClient)
      : walletClient;
    client = await createViemHandleClient(boundWallet);
    clients.set(key, client);
  }
  return client;
}

/**
 * Decrypts a handle the connected account is allowed to view. The TEE runner
 * resolves fresh handles asynchronously, so we retry while the value is being
 * computed (a few seconds on Sepolia).
 */
export async function decryptWhenReady(
  client: HandleClient,
  handle: `0x${string}`,
  { attempts = 20, delayMs = 3000 }: { attempts?: number; delayMs?: number } = {}
): Promise<bigint> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const { value } = await client.decrypt(handle as never);
      return value as bigint;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Handle not decryptable yet: ${String(lastError)}`);
}

/** Same retry pattern for publicly decryptable handles (withdraw finalization). */
export async function publicDecryptWhenReady(
  client: HandleClient,
  handle: `0x${string}`,
  { attempts = 20, delayMs = 3000 }: { attempts?: number; delayMs?: number } = {}
): Promise<{ value: bigint; decryptionProof: `0x${string}` }> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await client.publicDecrypt(handle as never);
      return { value: result.value as bigint, decryptionProof: result.decryptionProof as `0x${string}` };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Handle not publicly decryptable yet: ${String(lastError)}`);
}

export const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
