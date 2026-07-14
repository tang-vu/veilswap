import { formatUnits, parseUnits } from "viem";
import type { TokenInfo } from "../config/veilswap";

export function formatToken(amount: bigint, token: TokenInfo, precision = 6): string {
  const raw = formatUnits(amount, token.decimals);
  const [whole, frac = ""] = raw.split(".");
  const trimmed = frac.slice(0, precision).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function parseToken(input: string, token: TokenInfo): bigint {
  return parseUnits(input.trim() as `${number}`, token.decimals);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHandle(handle: string): string {
  return `${handle.slice(0, 10)}…${handle.slice(-6)}`;
}

export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "00:00";
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Spot prices (1e18-scaled, both directions) from a pool's sqrtPriceX96. */
export function spotPricesE18(sqrtPriceX96: bigint, aIsToken0: boolean): { aToB: bigint; bToA: bigint } {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  const oneFor0 = (priceX192 * 10n ** 18n) >> 192n;
  const zeroFor1 = ((1n << 192n) * 10n ** 18n) / priceX192;
  return aIsToken0 ? { aToB: oneFor0, bToA: zeroFor1 } : { aToB: zeroFor1, bToA: oneFor0 };
}
