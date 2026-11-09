import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoverRoute } from "./RecoverRoute.tsx";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";

const entry = {
  l1TxHash: `0x${"ab".repeat(32)}`, recipient: `0x${"12".repeat(32)}`,
  claimAmount: "1000000000000000000", phase: "ready-to-claim",
  networkId: "mainnet", createdAt: 1, updatedAt: 1,
  credentials: { recipient: `0x${"12".repeat(32)}`, claimAmount: "1000000000000000000" },
};
const flows = {} as BridgeFlows;
function render(selected: boolean, withCredentials = true) {
  const current = { ...entry, credentials: withCredentials ? entry.credentials : undefined };
  const session = {
    networkId: "mainnet", selectedRecoveryHash: selected ? entry.l1TxHash : null,
    selectedSession: selected ? current : null, recoverySessions: [current],
    storageReady: true, progress: null, busy: false,
  } as unknown as BridgeSession;
  return renderToStaticMarkup(<RecoverRoute session={session} flows={flows} />);
}

describe("Recover claim status", () => {
  it("shows the refresh control in the selected claim details, not the list", () => {
    expect(render(false)).not.toContain('aria-label="Refresh claim status"');
    const html = render(true);
    expect(html).toContain('aria-label="Refresh claim status"');
    expect(html).toContain("Use refresh to check claim status on Aztec.");
  });
  it("does not offer a status check without claim credentials", () => {
    expect(render(true, false)).not.toContain('aria-label="Refresh claim status"');
  });
});
