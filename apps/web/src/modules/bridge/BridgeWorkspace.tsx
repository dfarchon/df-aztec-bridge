import { useBridgeFlows } from "./hooks/useBridgeFlows.ts";
import { useBridgeSession } from "./hooks/useBridgeSession.ts";
import { WorkspaceView } from "./components/WorkspaceView.tsx";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";

/** Bridge shell: Ethereum wallet, DF Punk PXE, L1 deposit, and L2 claim recovery. */
export function BridgeWorkspace({ initialWallet = null }: { initialWallet?: ConnectedWallet | null }) {
  const session = useBridgeSession(initialWallet);
  const flows = useBridgeFlows(session);
  return <WorkspaceView session={session} flows={flows} />;
}
