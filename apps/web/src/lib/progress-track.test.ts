import { describe, expect, it } from "vitest";
import {
  advanceProgress,
  bridgePhaseStep,
  claimPhaseStep,
  displayProgressAt,
  finishProgress,
  formatElapsed,
  getTrack,
  shouldBlockUnload,
  startProgress,
  stepStateAt,
} from "./progress-track.ts";

describe("phase mapping", () => {
  it("collapses wallet-confirm and wait phases into one bridge step", () => {
    expect(bridgePhaseStep("approve_wallet")).toBe("approve");
    expect(bridgePhaseStep("approve_wait")).toBe("approve");
    expect(bridgePhaseStep("check_allowance")).toBe("approve");
    expect(bridgePhaseStep("bridge_wallet")).toBe("deposit");
    expect(bridgePhaseStep("bridge_wait")).toBe("deposit");
    expect(bridgePhaseStep("eth_fee_wallet")).toBe("eth_fee");
    expect(bridgePhaseStep("eth_fee_wait")).toBe("eth_fee");
  });

  it("maps every claim phase to a step that exists in the claim track", () => {
    const keys = getTrack("claim").steps.map((step) => step.key);
    for (const phase of ["wallet", "account", "l2-wait", "l2-claim", "l2-sent", "done"] as const) {
      expect(keys).toContain(claimPhaseStep(phase));
    }
  });
});

describe("advanceProgress", () => {
  it("moves forward through the track", () => {
    const started = startProgress("claim", "status", 1_000);
    expect(started.stepIndex).toBe(0);
    const next = advanceProgress(started, { track: "claim", stepKey: "account" }, 2_000);
    expect(next.stepIndex).toBe(2);
    expect(next.startedAt).toBe(1_000);
  });

  it("never walks backwards when the SDK re-emits an earlier phase", () => {
    let state = startProgress("claim", "status", 0);
    state = advanceProgress(state, { track: "claim", stepKey: claimPhaseStep("l2-claim") });
    state = advanceProgress(state, {
      track: "claim",
      stepKey: claimPhaseStep("l2-sent"),
      txSubmitted: true,
    });
    const confirmIndex = state.stepIndex;

    // claim-browser re-emits "l2-claim" while waiting for confirmation.
    state = advanceProgress(state, { track: "claim", stepKey: claimPhaseStep("l2-claim") });
    expect(state.stepIndex).toBe(confirmIndex);
    expect(state.txSubmitted).toBe(true);
  });

  it("restarts the timer when the track changes", () => {
    const bridge = startProgress("bridge", "prepare", 1_000);
    const claim = advanceProgress(bridge, { track: "claim", stepKey: "status" }, 9_000);
    expect(claim.track).toBe("claim");
    expect(claim.startedAt).toBe(9_000);
    expect(claim.stepIndex).toBe(0);
  });

  it("keeps txSubmitted sticky once set", () => {
    let state = startProgress("claim", "status", 0);
    state = advanceProgress(state, { track: "claim", stepKey: "confirm", txSubmitted: true });
    state = advanceProgress(state, { track: "claim", stepKey: "confirm" });
    expect(state.txSubmitted).toBe(true);
  });
});

describe("finishProgress", () => {
  it("jumps to the last step on success", () => {
    const state = finishProgress(startProgress("claim", "status", 0), "succeeded");
    expect(state?.stepIndex).toBe(getTrack("claim").steps.length - 1);
    expect(state?.runState).toBe("succeeded");
  });

  it("keeps the failing step visible on failure", () => {
    const running = advanceProgress(startProgress("claim", "status", 0), {
      track: "claim",
      stepKey: "prove",
    });
    const failed = finishProgress(running, "failed");
    expect(failed?.stepIndex).toBe(running.stepIndex);
    expect(stepStateAt(running.stepIndex, failed!)).toBe("failed");
  });
});

describe("stepStateAt", () => {
  it("classifies steps around the active one", () => {
    const state = advanceProgress(startProgress("claim", "status", 0), {
      track: "claim",
      stepKey: "account",
    });
    expect(stepStateAt(0, state)).toBe("done");
    expect(stepStateAt(state.stepIndex, state)).toBe("active");
    expect(stepStateAt(state.stepIndex + 1, state)).toBe("pending");
  });
});

describe("shouldBlockUnload", () => {
  it("guards a running flow that has no L2 tx yet", () => {
    expect(shouldBlockUnload(startProgress("claim", "pxe", 0))).toBe(true);
  });

  it("leaves the recovery tracks unguarded — they only re-read the chain", () => {
    expect(shouldBlockUnload(startProgress("resume-l1", "receipt", 0))).toBe(false);
    expect(shouldBlockUnload(startProgress("wait-l2", "confirm", 0))).toBe(false);
  });

  it("guards the bridge until the deposit is recorded", () => {
    expect(shouldBlockUnload(startProgress("bridge", "deposit", 0))).toBe(true);
  });

  it("releases the guard once the claim tx is submitted", () => {
    const state = advanceProgress(startProgress("claim", "status", 0), {
      track: "claim",
      stepKey: "confirm",
      txSubmitted: true,
    });
    expect(shouldBlockUnload(state)).toBe(false);
  });

  it("does not guard finished or missing flows", () => {
    expect(shouldBlockUnload(null)).toBe(false);
    expect(shouldBlockUnload(finishProgress(startProgress("claim", "pxe", 0), "failed"))).toBe(
      false,
    );
  });
});

describe("displayProgressAt", () => {
  it("walks one step at a time so skipped work still appears on screen", () => {
    const shown = startProgress("claim", "status", 0);
    const target = advanceProgress(shown, { track: "claim", stepKey: "prove" });
    const first = displayProgressAt(shown, target);
    expect(first.dwell).toBe(true);
    expect(first.next.stepIndex).toBe(1);
    expect(first.next.runState).toBe("running");

    const second = displayProgressAt(first.next, target);
    expect(second.next.stepIndex).toBe(2);
  });

  it("keeps the previous step visible before a track jump finishes", () => {
    const bridge = startProgress("bridge", "saved", 0);
    const claim = finishProgress(startProgress("claim", "status", 1), "succeeded")!;
    const reset = displayProgressAt(bridge, claim);
    expect(reset.next.track).toBe("claim");
    expect(reset.next.stepIndex).toBe(0);
    expect(reset.next.runState).toBe("running");
    expect(reset.dwell).toBe(true);

    let shown = reset.next;
    while (shown.stepIndex < claim.stepIndex) {
      const frame = displayProgressAt(shown, claim);
      expect(frame.dwell).toBe(true);
      shown = frame.next;
    }
    expect(shown.stepIndex).toBe(getTrack("claim").steps.length - 1);
    expect(shown.runState).toBe("succeeded");
  });

  it("does not delay once the panel has caught up", () => {
    const state = startProgress("claim", "pxe", 0);
    const frame = displayProgressAt(state, state);
    expect(frame.dwell).toBe(false);
    expect(frame.next).toEqual(state);
  });
});

describe("formatElapsed", () => {
  it("renders seconds below a minute and pads seconds above it", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(605_000)).toBe("10m 05s");
  });
});
