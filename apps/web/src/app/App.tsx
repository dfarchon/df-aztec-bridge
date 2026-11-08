import { AppProviders } from "../providers/AppProviders.tsx";
import { AppShell } from "../components/layout/AppShell.tsx";
import { BridgeWorkspace } from "../modules/bridge/BridgeWorkspace.tsx";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";

export function App({ initialWallet = null }: { initialWallet?: ConnectedWallet | null }) {
  return (
    <AppProviders>
      <AppShell>
        <BridgeWorkspace initialWallet={initialWallet} />
      </AppShell>
    </AppProviders>
  );
}
