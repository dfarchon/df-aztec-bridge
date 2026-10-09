import type { BridgeSession } from "./useBridgeSession.ts";
import { useBridgeActions } from "./useBridgeActions.ts";
import { useBridgeActivity } from "./useBridgeActivity.ts";

/** Claim, bridge, and form state composed for the workspace view. */
export function useBridgeFlows(session: BridgeSession) {
  const actions = useBridgeActions(session);
  const activity = useBridgeActivity(session);
  return { ...actions, ...activity };
}

export type BridgeFlows = ReturnType<typeof useBridgeFlows>;
