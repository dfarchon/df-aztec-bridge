import { formatUnits, parseUnits } from "viem";

export const FJ_DECIMALS = 18;
/** Anything smaller is not worth an L1 deposit + an L2 claim proof. */
export const MIN_BRIDGE_FJ = 3;
export const MIN_BRIDGE_WEI = parseUnits(String(MIN_BRIDGE_FJ), FJ_DECIMALS);

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
function formatFj(value: bigint): string {
  const raw = formatUnits(value, FJ_DECIMALS);
  if (!raw.includes(".")) return raw;
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0";
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
    neededFormatted: formatFj(needed),
    haveFormatted: formatFj(have),
    missingFormatted: formatFj(missing),
  };
}
