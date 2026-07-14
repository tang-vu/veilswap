import { useCallback, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { PAIR_ABI, PAIR_ADDRESS } from "../config/veilswap";

export type TxStatus = "idle" | "wallet" | "pending" | "success" | "error";

/**
 * Thin wrapper around a VeilSwapPair write: simulate → sign → wait for receipt,
 * then invalidate all read queries so panels refresh. Returns the receipt so
 * callers can decode emitted events (e.g. withdraw request ids).
 */
export function usePairWrite() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | undefined>();

  const write = useCallback(
    async (functionName: string, args: readonly unknown[]) => {
      if (!publicClient || !walletClient?.account) throw new Error("Wallet not connected");
      setStatus("wallet");
      setError(undefined);
      setTxHash(undefined);
      try {
        const { request } = await publicClient.simulateContract({
          address: PAIR_ADDRESS,
          abi: PAIR_ABI,
          functionName: functionName as never,
          args: args as never,
          account: walletClient.account,
        });
        const hash = await walletClient.writeContract(request as never);
        setTxHash(hash);
        setStatus("pending");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        setStatus("success");
        await queryClient.invalidateQueries();
        return receipt;
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? shortenError(err.message) : String(err));
        throw err;
      }
    },
    [publicClient, walletClient, queryClient]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(undefined);
    setTxHash(undefined);
  }, []);

  return { write, status, txHash, error, reset };
}

function shortenError(message: string): string {
  const firstLine = message.split("\n")[0];
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}
