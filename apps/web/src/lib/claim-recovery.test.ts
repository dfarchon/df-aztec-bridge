import { describe, expect, it } from "vitest";
import type { ClaimPhase } from "./bridge-session.ts";
import {
  recoverySteps,
  sessionsForAccounts,
  unknownAccountClaimMessage,
} from "./claim-recovery.ts";

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

  it("uses the saved Aztec account for phases that still send an L2 tx", () => {
    const usesSavedAccount = (phase: ClaimPhase) =>
      recoverySteps(phase).some((step) => /already saved in this browser/i.test(step));

    expect(usesSavedAccount("ready-to-claim")).toBe(true);
    expect(usesSavedAccount("claiming")).toBe(true);
    expect(usesSavedAccount("failed")).toBe(true);
    expect(usesSavedAccount("l1-pending")).toBe(false);
    expect(usesSavedAccount("claim-sent")).toBe(false);
  });

  it("does not ask the user to import an account again", () => {
    for (const phase of ALL_PHASES) {
      expect(recoverySteps(phase).join(" ")).not.toMatch(/Import the Aztec account|secretKey/i);
    }
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

describe("sessionsForAccounts", () => {
  const owned = "0xAbCdEf0000000000000000000000000000000001";
  const other = "0x1111111111111111111111111111111111111111";

  it("keeps only claims for an Aztec account already in this browser", () => {
    const sessions = [
      { recipient: owned, credentials: null },
      { recipient: other, credentials: { recipient: other } },
      { recipient: other, credentials: { recipient: owned.toLowerCase() } },
    ];
    expect(sessionsForAccounts(sessions, [{ address: owned }])).toEqual([
      sessions[0],
      sessions[2],
    ]);
  });

  it("hides every claim when no Aztec account is saved", () => {
    expect(
      sessionsForAccounts([{ recipient: owned, credentials: null }], []),
    ).toEqual([]);
  });
});

describe("unknownAccountClaimMessage", () => {
  it("says the claim was not imported", () => {
    expect(unknownAccountClaimMessage("0xabcdef0000000000000000000000000000000001")).toMatch(
      /not imported/i,
    );
  });
});
