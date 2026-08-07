import { AppProviders } from "../providers/AppProviders.tsx";
import { AppShell } from "../components/layout/AppShell.tsx";
import { BridgeWorkspace } from "../modules/bridge/BridgeWorkspace.tsx";

export function App() {
  return (
    <AppProviders>
      <AppShell>
        <BridgeWorkspace />
      </AppShell>
    </AppProviders>
  );
}
