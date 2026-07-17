import { useMemo, useState } from "react";
import { useAccount, useBalance, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { ERC20_ABI, ETHERSCAN_BASE, PAIR_ADDRESS, TOKEN_A, TOKEN_B, WETH_DEPOSIT_ABI } from "../config/veilswap";
import { formatToken, parseToken } from "../lib/format";
import { usePairWrite } from "../hooks/use-pair-write";
import { TokenSelect } from "./token-select";

/** ERC-20 → encrypted balance. The deposit amount is the LAST public trace. */
export function DepositPanel() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const [token, setToken] = useState(TOKEN_A);
  const [amount, setAmount] = useState("");
  const [approving, setApproving] = useState(false);
  const { write, status, txHash, error } = usePairWrite();

  const parsed = useMemo(() => {
    try {
      return amount ? parseToken(amount, token) : 0n;
    } catch {
      return null;
    }
  }, [amount, token]);

  const { data: walletBalance } = useReadContract({
    address: token.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });

  const { data: allowance } = useReadContract({
    address: token.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, PAIR_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });

  const needsApproval = parsed !== null && parsed > 0n && (allowance ?? 0n) < parsed;

  // Judge onboarding: if the wallet lacks WETH but holds ETH, offer in-app wrapping.
  const { data: ethBalance } = useBalance({ address, query: { refetchInterval: 15000 } });
  const [wrapping, setWrapping] = useState(false);
  const needsWrap =
    token.address === TOKEN_A.address &&
    parsed !== null &&
    parsed > 0n &&
    (walletBalance ?? 0n) < parsed &&
    (ethBalance?.value ?? 0n) > parsed;

  async function wrapEth() {
    if (!walletClient?.account || !publicClient || parsed === null) return;
    setWrapping(true);
    try {
      const hash = await walletClient.writeContract({
        address: TOKEN_A.address,
        abi: WETH_DEPOSIT_ABI,
        functionName: "deposit",
        value: parsed,
        account: walletClient.account,
        chain: walletClient.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await queryClient.invalidateQueries();
    } finally {
      setWrapping(false);
    }
  }

  async function approve() {
    if (!walletClient?.account || !publicClient || parsed === null) return;
    setApproving(true);
    try {
      const hash = await walletClient.writeContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PAIR_ADDRESS, parsed],
        account: walletClient.account,
        chain: walletClient.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await queryClient.invalidateQueries();
    } finally {
      setApproving(false);
    }
  }

  async function deposit() {
    if (parsed === null || parsed === 0n) return;
    await write("deposit", [token.address, parsed]);
    setAmount("");
  }

  return (
    <div className="panel">
      <h2>Deposit</h2>
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
      <div className="form-meta">
        <span className="dim">
          wallet: {walletBalance !== undefined ? formatToken(walletBalance, token) : "…"} {token.symbol}
        </span>
        {parsed === null && <span className="error-text">invalid amount</span>}
      </div>
      {needsWrap ? (
        <button className="btn btn-primary" onClick={wrapEth} disabled={wrapping}>
          {wrapping ? "wrapping…" : `wrap ${amount} ETH → WETH first`}
        </button>
      ) : needsApproval ? (
        <button className="btn btn-primary" onClick={approve} disabled={approving}>
          {approving ? "approving…" : `approve ${token.symbol}`}
        </button>
      ) : (
        <button
          className="btn btn-primary"
          onClick={deposit}
          disabled={parsed === null || parsed === 0n || status === "wallet" || status === "pending"}
        >
          {status === "wallet" ? "confirm in wallet…" : status === "pending" ? "depositing…" : "deposit"}
        </button>
      )}
      {txHash && status === "success" && (
        <a className="link" href={`${ETHERSCAN_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer">
          deposited — view tx ↗
        </a>
      )}
      {error && <span className="error-text">{error}</span>}
      <p className="privacy-note">
        After this transaction, your activity inside VeilSwap is invisible: balances, trades and
        transfers are encrypted handles.
      </p>
    </div>
  );
}
