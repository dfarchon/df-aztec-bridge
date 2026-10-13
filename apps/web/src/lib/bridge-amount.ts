import { formatUnits, parseUnits } from "viem";

export const FJ_DECIMALS = 18;
/** Anything smaller is not worth an L1 deposit + an L2 claim proof. */
export const MIN_BRIDGE_FJ = 3;
export const MIN_BRIDGE_WEI = parseUnits(String(MIN_BRIDGE_FJ), FJ_DECIMALS);
/** Range input ticks from 0 to this value. */
export const AMOUNT_SLIDER_MAX = 10_000;
/** Slider / percent fills keep this many fractional digits; typed input can go to 18. */
export const SLIDER_AMOUNT_DECIMALS = 4;
export const AMOUNT_PRESET_PERCENTS = [25, 50, 75, 100] as const;
export type AmountPresetPercent = (typeof AMOUNT_PRESET_PERCENTS)[number];

const DECIMAL_INPUT = /^\d+(\.\d{1,18})?$/;
const DRAFT_AMOUNT = /^\d+\.$/;

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

/** Empty or a trailing-dot draft such as `3.` — show the minimum hint, not a parse error. */
export function isDraftAmountInput(input: string): boolean {
  const trimmed = input.trim();
  return !trimmed || DRAFT_AMOUNT.test(trimmed);
}

/** Keep digits and one decimal point, at most 18 fractional places. */
export function sanitizeAmountInput(raw: string): string {
  let next = "";
  let sawDot = false;
  let frac = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (sawDot) {
        if (frac >= FJ_DECIMALS) continue;
        frac += 1;
      }
      next += ch;
    } else if (ch === "." && !sawDot) {
      sawDot = true;
      next += ch;
    }
  }
  if (next.startsWith(".")) next = `0${next}`;
  return next;
}

/** Parse a typed amount for the slider, including drafts like `3.`. */
export function parseAmountWeiLoose(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const usable = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  if (!usable || !DECIMAL_INPUT.test(usable)) return null;
  try {
    return parseUnits(usable, FJ_DECIMALS);
  } catch {
    return null;
  }
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

/** Floor to `SLIDER_AMOUNT_DECIMALS` so a drag never exceeds the wallet. */
export function formatSliderAmount(value: bigint): string {
  if (value <= 0n) return "0";
  const scale = 10n ** BigInt(FJ_DECIMALS - SLIDER_AMOUNT_DECIMALS);
  return formatFjAmount(value - (value % scale), SLIDER_AMOUNT_DECIMALS);
}

export function amountFromPercent(balance: bigint, percent: number): bigint {
  if (percent >= 100) return balance;
  if (percent <= 0 || balance <= 0n) return 0n;
  return (balance * BigInt(percent)) / 100n;
}

export function amountFromSlider(balance: bigint, position: number): bigint {
  const clamped = Math.max(0, Math.min(AMOUNT_SLIDER_MAX, Math.floor(position)));
  if (clamped <= 0 || balance <= 0n) return 0n;
  if (clamped >= AMOUNT_SLIDER_MAX) return balance;
  return (balance * BigInt(clamped)) / BigInt(AMOUNT_SLIDER_MAX);
}

export function sliderFromAmount(balance: bigint, amount: bigint | null): number {
  if (balance <= 0n || amount == null || amount <= 0n) return 0;
  if (amount >= balance) return AMOUNT_SLIDER_MAX;
  if (formatSliderAmount(amount) === formatSliderAmount(balance)) return AMOUNT_SLIDER_MAX;
  return Number((amount * BigInt(AMOUNT_SLIDER_MAX)) / balance);
}

export interface AmountPreset {
  percent: AmountPresetPercent;
  label: string;
  amountFj: string;
  wei: bigint;
  disabled: boolean;
}

export function amountPresets(balance: bigint): AmountPreset[] {
  return AMOUNT_PRESET_PERCENTS.map((percent) => {
    const wei = amountFromPercent(balance, percent);
    return {
      percent,
      label: percent === 100 ? "Max" : `${percent}%`,
      amountFj: formatSliderAmount(wei),
      wei,
      disabled: wei < MIN_BRIDGE_WEI,
    };
  });
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
