import type { BridgeSessionEntry, ClaimPhase } from "./bridge-session.ts";

export function shortHash(value: string, left = 8, right = 6): string {
  if (value.length <= left + right + 1) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function phaseLabel(phase: ClaimPhase): string {
  switch (phase) {
    case "l1-pending":
      return "Waiting for L1 confirmation";
    case "ready-to-claim":
      return "Ready to claim on L2";
    case "claiming":
      return "Claim in progress";
    case "claim-sent":
      return "Waiting for L2 confirmation";
    case "failed":
      return "Claim failed — retry available";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

const NAVIGATION_STEP =
  "Open the Recover tab and select this bridge — the button below does it for you.";

function phaseSteps(phase: ClaimPhase): string[] {
  switch (phase) {
    case "l1-pending":
      return [
        "Press “Retry resume”. The app re-reads the L1 receipt and rebuilds your claim credentials; no account keys are needed.",
        "Once the credentials are restored, follow the L2 claim steps shown for this bridge.",
      ];
    case "claim-sent":
      return [
        "Press “Wait for L2 confirmation”. The claim transaction is already on L2, so no account keys are needed.",
        "You may close this tab and come back later — the claim finishes on its own.",
      ];
    case "ready-to-claim":
    case "claiming":
    case "failed":
      return [
        "Import the Aztec account JSON for the recipient shown below, or paste its secretKey / salt / signingKey by hand. Keys stay in memory and are never written to browser storage.",
        "Press “Resume L2 claim”. Proving runs inside this tab and usually takes several minutes.",
        "Leave this tab open until the progress panel reports the claim confirmed.",
      ];
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/**
 * What the user has to do, in order, to finish an interrupted bridge. Which
 * steps apply depends on the phase: only the phases that still need to send an
 * L2 tx require the Aztec account keys. Callers that are already showing the
 * session controls should leave `includeNavigation` off.
 */
export function recoverySteps(
  phase: ClaimPhase,
  opts?: { includeNavigation?: boolean },
): string[] {
  const steps = phaseSteps(phase);
  return opts?.includeNavigation ? [NAVIGATION_STEP, ...steps] : steps;
}

export function selectSessionForUi(
  sessions: BridgeSessionEntry[],
  activeL1TxHash: string | null,
): BridgeSessionEntry | null {
  if (sessions.length === 0) return null;
  if (activeL1TxHash) {
    const active = sessions.find(
      (session) => session.l1TxHash.toLowerCase() === activeL1TxHash.toLowerCase(),
    );
    if (active) return active;
  }
  return sessions[0] ?? null;
}
