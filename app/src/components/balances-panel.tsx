import { useState } from "react";
import { useAccount, useReadContract, useWalletClient } from "wagmi";
import { PAIR_ABI, PAIR_ADDRESS, TOKEN_A, TOKEN_B, type TokenInfo } from "../config/veilswap";
import { decryptWhenReady, getHandleClient, ZERO_HANDLE } from "../lib/nox-client";
import { formatToken } from "../lib/format";
import { CipherText } from "../veil/veiled-value";
import { useVeil } from "../veil/veil-context";

/**
 * Encrypted balances. The chain (and this app, until you click decrypt) only
 * ever sees the 32-byte handle; decryption happens client-side through the Nox
 * SDK with your wallet's signature.
 */
export function BalancesPanel() {
  return (
    <div className="panel">
      <h2>Encrypted balances</h2>
      <BalanceRow token={TOKEN_A} />
      <BalanceRow token={TOKEN_B} />
    </div>
  );
}

function BalanceRow({ token }: { token: TokenInfo }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { chainView } = useVeil();
  const [state, setState] = useState<{ handle?: string; value?: bigint; busy?: boolean; error?: string }>({});

  const { data: handle } = useReadContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: "balanceHandle",
    args: address ? [address, token.address] : undefined,
    query: { enabled: !!address, refetchInterval: 8000 },
  });

  const currentHandle = (handle as string | undefined) ?? ZERO_HANDLE;
  const isEmpty = currentHandle === ZERO_HANDLE;
  const decryptedIsCurrent = state.handle === currentHandle && state.value !== undefined;
  // An observer holds no decryption key, so chain view never shows plaintext.
  const showPlaintext = decryptedIsCurrent && !chainView;

  async function decrypt() {
    if (!walletClient || isEmpty) return;
    setState({ busy: true });
    try {
      const client = await getHandleClient(walletClient);
      const value = await decryptWhenReady(client, currentHandle as `0x${string}`);
      setState({ handle: currentHandle, value });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="balance-row">
      <span className="token-symbol">{token.symbol}</span>
      {isEmpty ? (
        <span className="dim">no balance handle yet — deposit to create one</span>
      ) : showPlaintext ? (
        <span className="mono balance-value revealed">
          {formatToken(state.value!, token)} <span className="dim">{token.symbol}</span>
        </span>
      ) : (
        <span className="balance-value">
          <CipherText handle={currentHandle} />
        </span>
      )}
      {!isEmpty &&
        (chainView ? (
          <span className="label" title="An observer has no key for this handle">
            no key
          </span>
        ) : (
          <button className="btn btn-ghost" onClick={decrypt} disabled={state.busy || decryptedIsCurrent}>
            {state.busy
              ? "decrypting…"
              : decryptedIsCurrent
                ? "decrypted"
                : state.value !== undefined
                  ? "re-decrypt"
                  : "decrypt"}
          </button>
        ))}
      {state.error && <span className="error-text">{state.error}</span>}
    </div>
  );
}
