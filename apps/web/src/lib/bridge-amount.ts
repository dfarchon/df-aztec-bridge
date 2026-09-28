import { formatUnits, parseUnits } from "viem";

export const FJ_DECIMALS = 18;
/** Anything smaller is not worth an L1 deposit + an L2 claim proof. */
export const MIN_BRIDGE_FJ = 3;
export const MIN_BRIDGE_WEI = parseUnits(String(MIN_BRIDGE_FJ), FJ_DECIMALS);
/**
 * Below this balance the quick-fill control is Max (whole wallet).
 * At/above it we only suggest a fixed amount so Max cannot drain a large bag.
 */
export const QUICK_MAX_BALANCE_FJ = 100;
export const QUICK_MAX_BALANCE_WEI = parseUnits(String(QUICK_MAX_BALANCE_FJ), FJ_DECIMALS);
/** Suggested bridge size when minting is available or the wallet can cover it. */
export const SUGGESTED_BRIDGE_FJ = 300;
export const SUGGESTED_BRIDGE_WEI = parseUnits(String(SUGGESTED_BRIDGE_FJ), FJ_DECIMALS);

const DECIMAL_INPUT = /^\d+(\.\d{1,18})?$/;

export interface BridgeAmountCheck {
  /** Parsed base-unit value, or null when the input cannot be bridged. */
  wei: bigint | null;
  error: string | null;
}

export function parseBridgeAmount(input: string): BridgeAmountCheck {
  const trimmed = input.trim();
  if (!trimmed) {
    return { wei: null, error: "Enter an amount to bridge." };
  }
  if (!DECIMAL_INPUT.test(trimmed)) {
    return { wei: null, error: "Enter a plain decimal amount, for example 3 or 3.5." };
  }
  const wei = parseUnits(trimmed, FJ_DECIMALS);
  if (wei < MIN_BRIDGE_WEI) {
    return {
      wei: null,
      error: `Minimum bridge amount is ${MIN_BRIDGE_FJ} FJ.`,
    };
  }
  return { wei, error: null };
}

export interface BridgeShortfall {
  needed: bigint;
  have: bigint;
  missing: bigint;
  neededFormatted: string;
  haveFormatted: string;
  missingFormatted: string;
}

/** Trim the trailing zeros `formatUnits` leaves on whole-ish values. */
export function formatFjAmount(value: bigint, maxDecimals?: number): string {
  const decimals =
    maxDecimals == null ? FJ_DECIMALS : Math.max(0, Math.min(FJ_DECIMALS, Math.floor(maxDecimals)));
  let shown = value;
  if (decimals < FJ_DECIMALS) {
    const scale = 10n ** BigInt(FJ_DECIMALS - decimals);
    shown = (value + scale / 2n) / scale;
  }
  const raw = formatUnits(shown, decimals);
  if (!raw.includes(".")) return raw;
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0";
}

/** Return a quick-fill action that is always valid for the current network. */
export function amountQuickFill(
  balance: bigint,
  canMint = false,
): {
  label: string;
  amountFj: string;
} | null {
  if (canMint) {
    return { label: `Add ${SUGGESTED_BRIDGE_FJ}`, amountFj: String(SUGGESTED_BRIDGE_FJ) };
  }
  if (balance < MIN_BRIDGE_WEI) return null;
  if (balance < QUICK_MAX_BALANCE_WEI) {
    return { label: "Max", amountFj: formatFjAmount(balance) };
  }
  if (balance < SUGGESTED_BRIDGE_WEI) {
    return {
      label: `Add ${QUICK_MAX_BALANCE_FJ}`,
      amountFj: String(QUICK_MAX_BALANCE_FJ),
    };
  }
  return { label: `Add ${SUGGESTED_BRIDGE_FJ}`, amountFj: String(SUGGESTED_BRIDGE_FJ) };
}

/**
 * How much L1 Fee Juice / AZTEC the holder is missing, or null when the balance
 * covers the deposit. Callers must skip this on networks with a faucet handler,
 * where the bridge mints what it needs.
 */
export function bridgeShortfall(needed: bigint, have: bigint): BridgeShortfall | null {
  if (have >= needed) return null;
  const missing = needed - have;
  return {
    needed,
    have,
    missing,
    neededFormatted: formatFjAmount(needed),
    haveFormatted: formatFjAmount(have),
    missingFormatted: formatFjAmount(missing),
  };
}
