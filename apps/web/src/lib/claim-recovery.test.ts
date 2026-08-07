import { describe, expect, it } from "vitest";
import type { ClaimPhase } from "./bridge-session.ts";
import { recoverySteps } from "./claim-recovery.ts";

const ALL_PHASES: ClaimPhase[] = [
  "l1-pending",
  "ready-to-claim",
  "claiming",
  "claim-sent",
  "failed",
];

describe("recoverySteps", () => {
  it("gives every phase an actionable path", () => {
    for (const phase of ALL_PHASES) {
      const steps = recoverySteps(phase);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((step) => step.trim().length > 0)).toBe(true);
    }
  });

  it("only asks for account keys in the phases that still send an L2 tx", () => {
    const needsKeys = (phase: ClaimPhase) =>
      recoverySteps(phase).some((step) => /account JSON|secretKey/.test(step));

    expect(needsKeys("ready-to-claim")).toBe(true);
    expect(needsKeys("claiming")).toBe(true);
    expect(needsKeys("failed")).toBe(true);
    expect(needsKeys("l1-pending")).toBe(false);
    expect(needsKeys("claim-sent")).toBe(false);
  });

  it("tells claim-sent users the work already left the browser", () => {
    const steps = recoverySteps("claim-sent").join(" ");
    expect(steps).toMatch(/no account keys are needed/i);
    expect(steps).toMatch(/close this tab/i);
  });

  it("prepends the navigation step only when asked", () => {
    for (const phase of ALL_PHASES) {
      const plain = recoverySteps(phase);
      const navigated = recoverySteps(phase, { includeNavigation: true });
      expect(navigated).toHaveLength(plain.length + 1);
      expect(navigated[0]).toMatch(/Recover tab/);
      expect(navigated.slice(1)).toEqual(plain);
    }
  });
});
