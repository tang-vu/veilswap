import { useMemo, useState } from "react";
import { useWalletClient } from "wagmi";
import { isAddress } from "viem";
import { PAIR_ADDRESS, TOKEN_A } from "../config/veilswap";
import { parseToken } from "../lib/format";
import { getHandleClient } from "../lib/nox-client";
import { usePairWrite } from "../hooks/use-pair-write";
import { TokenSelect } from "./token-select";

/**
 * Private payments inside the pool: the transferred amount is an encrypted
 * handle. All-or-nothing semantics mean even success/failure stays private.
 */
export function TransferPanel() {
  const { data: walletClient } = useWalletClient();
  const [token, setToken] = useState(TOKEN_A);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const { write, status, error } = usePairWrite();

  const parsed = useMemo(() => {
    try {
      return amount ? parseToken(amount, token) : 0n;
    } catch {
      return null;
    }
  }, [amount, token]);

  const validRecipient = isAddress(recipient);

  async function transfer() {
    if (!walletClient || !validRecipient || parsed === null || parsed === 0n) return;
    setEncrypting(true);
    try {
      const client = await getHandleClient(walletClient);
      const enc = await client.encryptInput(parsed, "uint256", PAIR_ADDRESS);
      setEncrypting(false);
      await write("confidentialTransfer", [recipient, token.address, enc.handle, enc.handleProof]);
      setAmount("");
      setRecipient("");
    } finally {
      setEncrypting(false);
    }
  }

  const busy = encrypting || status === "wallet" || status === "pending";

  return (
    <div className="panel">
      <h2>Private transfer</h2>
      <div className="form-row">
        <TokenSelect value={token} onChange={setToken} />
        <input
          className="input mono"
          placeholder="0.0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
        />
      </div>
      <input
        className="input mono"
        placeholder="recipient 0x…"
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
      />
      {recipient && !validRecipient && <span className="error-text">invalid address</span>}
      <button className="btn btn-primary" onClick={transfer} disabled={busy || !validRecipient || !parsed}>
        {encrypting ? "encrypting amount…" : busy ? "transferring…" : "transfer privately"}
      </button>
      {status === "success" && <div className="pending-chip">transferred — the amount never appeared on-chain</div>}
      {error && <span className="error-text">{error}</span>}
      <p className="privacy-note">
        Observers see that you interacted with the recipient, but never how much. Amounts stay
        encrypted end-to-end.
      </p>
    </div>
  );
}
