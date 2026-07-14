import { useState } from "react";
import { useAccount, useReadContract, useWalletClient } from "wagmi";
import { PAIR_ABI, PAIR_ADDRESS, TOKEN_A, TOKEN_B, type TokenInfo } from "../config/veilswap";
import { decryptWhenReady, getHandleClient, ZERO_HANDLE } from "../lib/nox-client";
import { formatToken, shortHandle } from "../lib/format";

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
      ) : decryptedIsCurrent ? (
        <span className="mono balance-value">
          {formatToken(state.value!, token)} <span className="dim">{token.symbol}</span>
        </span>
      ) : (
        <span className="mono dim" title={currentHandle}>
          {shortHandle(currentHandle)}
        </span>
      )}
      {!isEmpty && (
        <button className="btn btn-ghost" onClick={decrypt} disabled={state.busy || decryptedIsCurrent}>
          {state.busy ? "decrypting…" : decryptedIsCurrent ? "decrypted" : state.value !== undefined ? "re-decrypt" : "decrypt"}
        </button>
      )}
      {state.error && <span className="error-text">{state.error}</span>}
    </div>
  );
}
