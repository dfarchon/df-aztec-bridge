/**
 * Aztec tip / next-block pace helpers for claim progress UI.
 *
 * Public networks: ~6s sequencer block sub-slots (SEQ_BLOCK_DURATION_MS).
 * Local: follow VITE_LOCAL_TICK_INTERVAL_MS (same as explorer tip poll).
 */

export type BlockPace = "on-time" | "due" | "behind";

/** Default public Aztec block sub-slot estimate (ms). */
export const DEFAULT_AZTEC_BLOCK_MS = 6_000;

/** Yellow window: last quarter of the interval before predicted next tip. */
export const DUE_FRACTION = 0.25;

export function defaultBlockIntervalMs(networkId: string | undefined): number {
  if (networkId === "local") {
    const raw = import.meta.env.VITE_LOCAL_TICK_INTERVAL_MS;
    const n = Number(raw ?? "4000");
    return Math.max(1_000, Number.isFinite(n) && n > 0 ? n : 4_000);
  }
  return DEFAULT_AZTEC_BLOCK_MS;
}

/**
 * Blend a measured tip interval with the network default so a slow/fast
 * tip does not jump the countdown wildly on first sample.
 */
export function blendIntervalMs(observedMs: number | null, baselineMs: number): number {
  if (observedMs == null || !Number.isFinite(observedMs) || observedMs <= 0) {
    return baselineMs;
  }
  const clamped = Math.min(Math.max(observedMs, baselineMs * 0.5), baselineMs * 3);
  return Math.round(baselineMs * 0.55 + clamped * 0.45);
}

export function remainingUntilPredicted(predictedAt: number, now = Date.now()): number {
  return predictedAt - now;
}

export function paceFromRemaining(remainingMs: number, intervalMs: number): BlockPace {
  if (remainingMs <= 0) return "behind";
  const dueWindow = Math.max(750, Math.floor(intervalMs * DUE_FRACTION));
  if (remainingMs <= dueWindow) return "due";
  return "on-time";
}

export function formatCountdown(remainingMs: number): string {
  const overdue = remainingMs < 0;
  const abs = Math.abs(remainingMs);
  const totalSec = Math.ceil(abs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const body = m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
  return overdue ? `+${body}` : body;
}

export function paceLabel(pace: BlockPace): string {
  switch (pace) {
    case "behind":
      return "behind estimate";
    case "due":
      return "due soon";
    default:
      return "on time";
  }
}
