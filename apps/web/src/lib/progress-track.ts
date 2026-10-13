import type { BridgeProgressPhase, BrowserClaimProgress } from "@df-bridge/browser-sdk";

export type ProgressTrackId = "bridge" | "claim" | "resume-l1" | "wait-l2";
export type ProgressRunState = "running" | "succeeded" | "failed";
export type ProgressStepState = "done" | "active" | "failed" | "pending";

export interface ProgressStep {
  key: string;
  label: string;
  /** Shown under the step while it is the active one. */
  note?: string;
}

export interface ProgressTrack {
  id: ProgressTrackId;
  title: string;
  steps: ProgressStep[];
}

export interface ProgressState {
  track: ProgressTrackId;
  stepIndex: number;
  runState: ProgressRunState;
  startedAt: number;
  /**
   * True once the L2 claim tx is on chain. From that point a reload only costs
   * the confirmation wait, not the proving work, so the unload guard can relax.
   */
  txSubmitted: boolean;
}

const BRIDGE_TRACK: ProgressTrack = {
  id: "bridge",
  title: "Bridging Fee Juice to Aztec",
  steps: [
    { key: "prepare", label: "Preparing the L1 transaction" },
    {
      key: "eth_fee",
      label: "Paying mainnet ETH service fee (~1 L1 tx)",
      note: "Batched with AZTEC fee + approve + deposit when your wallet supports it.",
    },
    { key: "mint", label: "Minting test Fee Juice", note: "Confirm in your wallet." },
    {
      key: "approve",
      label: "Approving Fee Juice spend",
      note: "Often batched with fees + deposit in one wallet confirm.",
    },
    {
      key: "deposit",
      label: "Submitting the L1 deposit",
      note: "May share one confirm with ETH fee, AZTEC fee, and approve.",
    },
    { key: "receipt", label: "Reading the L1 deposit event" },
    { key: "saved", label: "Saving claim credentials" },
  ],
};

const CLAIM_TRACK: ProgressTrack = {
  id: "claim",
  title: "Claiming Fee Juice on Aztec L2",
  steps: [
    { key: "status", label: "Checking the L1\u2192L2 message" },
    {
      key: "pxe",
      label: "Starting the in-browser prover (PXE)",
      note: "First run downloads a large bundle \u2014 this can take a few minutes.",
    },
    { key: "account", label: "Registering your Aztec account" },
    {
      key: "message",
      label: "Waiting for the L1\u2192L2 message on Aztec",
      note: "Aztec usually needs several minutes after the L1 tx.",
    },
    {
      key: "prove",
      label: "Generating the proof and submitting the claim",
      note: "Proving runs on your device and is the slowest step.",
    },
    { key: "confirm", label: "Waiting for L2 confirmation" },
    { key: "done", label: "Fee Juice claimed" },
  ],
};

const RESUME_L1_TRACK: ProgressTrack = {
  id: "resume-l1",
  title: "Recovering the pending L1 bridge",
  steps: [
    { key: "receipt", label: "Waiting for the L1 receipt" },
    { key: "credentials", label: "Rebuilding claim credentials" },
  ],
};

const WAIT_L2_TRACK: ProgressTrack = {
  id: "wait-l2",
  title: "Waiting for your L2 claim",
  steps: [
    { key: "confirm", label: "Waiting for L2 confirmation" },
    { key: "done", label: "Fee Juice claimed" },
  ],
};

const TRACKS: Record<ProgressTrackId, ProgressTrack> = {
  bridge: BRIDGE_TRACK,
  claim: CLAIM_TRACK,
  "resume-l1": RESUME_L1_TRACK,
  "wait-l2": WAIT_L2_TRACK,
};

const BRIDGE_PHASE_STEP: Record<BridgeProgressPhase, string> = {
  prepare: "prepare",
  eth_fee_wallet: "eth_fee",
  eth_fee_wait: "eth_fee",
  mint_wallet: "mint",
  mint_wait: "mint",
  check_allowance: "approve",
  approve_wallet: "approve",
  approve_wait: "approve",
  bridge_wallet: "deposit",
  bridge_wait: "deposit",
  parse_receipt: "receipt",
};

const CLAIM_PHASE_STEP: Record<BrowserClaimProgress, string> = {
  wallet: "pxe",
  account: "account",
  "l2-wait": "message",
  "l2-claim": "prove",
  "l2-sent": "confirm",
  done: "done",
};

export function getTrack(track: ProgressTrackId): ProgressTrack {
  return TRACKS[track];
}

export function bridgePhaseStep(phase: BridgeProgressPhase): string {
  return BRIDGE_PHASE_STEP[phase] ?? "prepare";
}

export function claimPhaseStep(phase: BrowserClaimProgress): string {
  return CLAIM_PHASE_STEP[phase] ?? "pxe";
}

function indexOfStep(track: ProgressTrackId, stepKey: string): number {
  const index = TRACKS[track].steps.findIndex((step) => step.key === stepKey);
  return index < 0 ? 0 : index;
}

export function startProgress(
  track: ProgressTrackId,
  stepKey: string,
  now: number = Date.now(),
): ProgressState {
  return {
    track,
    stepIndex: indexOfStep(track, stepKey),
    runState: "running",
    startedAt: now,
    txSubmitted: false,
  };
}

/** How long a completed step stays on screen before the panel walks to the next one. */
export const PROGRESS_STEP_DWELL_MS = 500;

/**
 * One frame of the on-screen progress walk. The real work can skip ahead; the
 * panel still ticks through each step so the user can follow the sequence.
 */
export function displayProgressAt(
  shown: ProgressState,
  target: ProgressState,
): { next: ProgressState; dwell: boolean } {
  if (shown.track !== target.track) {
    const failedAtStart = target.runState === "failed" && target.stepIndex === 0;
    return {
      next: {
        ...target,
        stepIndex: 0,
        runState: failedAtStart ? "failed" : "running",
      },
      dwell: target.stepIndex > 0 || target.runState !== "running",
    };
  }
  if (shown.stepIndex < target.stepIndex) {
    const stepIndex = shown.stepIndex + 1;
    const caughtUp = stepIndex >= target.stepIndex;
    return {
      next: {
        ...target,
        stepIndex,
        runState: !caughtUp || target.runState === "running" ? "running" : target.runState,
      },
      dwell: true,
    };
  }
  return { next: target, dwell: false };
}

/**
 * Move a track forward. The step index never decreases, because the SDK
 * re-emits earlier phases (`l2-claim` fires again after `l2-sent` while waiting
 * for confirmation) and the UI must not appear to walk backwards.
 */
export function advanceProgress(
  current: ProgressState | null,
  patch: {
    track: ProgressTrackId;
    stepKey: string;
    txSubmitted?: boolean;
  },
  now: number = Date.now(),
): ProgressState {
  if (!current || current.track !== patch.track) {
    const fresh = startProgress(patch.track, patch.stepKey, now);
    return patch.txSubmitted ? { ...fresh, txSubmitted: true } : fresh;
  }
  return {
    ...current,
    runState: "running",
    stepIndex: Math.max(current.stepIndex, indexOfStep(patch.track, patch.stepKey)),
    txSubmitted: current.txSubmitted || patch.txSubmitted === true,
  };
}

export function finishProgress(
  current: ProgressState | null,
  runState: Exclude<ProgressRunState, "running">,
): ProgressState | null {
  if (!current) return null;
  const lastIndex = TRACKS[current.track].steps.length - 1;
  return {
    ...current,
    runState,
    stepIndex: runState === "succeeded" ? lastIndex : current.stepIndex,
  };
}

export function stepStateAt(index: number, progress: ProgressState): ProgressStepState {
  if (index < progress.stepIndex) return "done";
  if (index > progress.stepIndex) return "pending";
  if (progress.runState === "failed") return "failed";
  if (progress.runState === "succeeded") return "done";
  return "active";
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Tracks that hold state only this tab knows about: the bridge holds the freshly
 * generated claim secret until the deposit is saved, and the claim holds an
 * in-flight proof. The recovery tracks only re-read chain state, so leaving them
 * costs nothing.
 */
const COSTLY_TRACKS: ReadonlySet<ProgressTrackId> = new Set(["bridge", "claim"]);

/**
 * Whether leaving the page would throw away work that a reload cannot redo for
 * free. Also drives the panel notice, so the warning and the native prompt
 * cannot disagree.
 */
export function shouldBlockUnload(progress: ProgressState | null): boolean {
  if (!progress || progress.runState !== "running") return false;
  if (!COSTLY_TRACKS.has(progress.track)) return false;
  return !progress.txSubmitted;
}
