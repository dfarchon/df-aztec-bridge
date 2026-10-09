import { useBridgeFlows } from "./hooks/useBridgeFlows.ts";
import { useBridgeSession } from "./hooks/useBridgeSession.ts";
import { WorkspaceView } from "./components/WorkspaceView.tsx";

/** Bridge shell: Ethereum wallet, DF Punk PXE, L1 deposit, and L2 claim recovery. */
export function BridgeWorkspace() {
  const session = useBridgeSession();
  const flows = useBridgeFlows(session);
  return <WorkspaceView session={session} flows={flows} />;
}
