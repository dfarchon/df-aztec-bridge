import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.tsx";
import { DappLogToaster } from "../ui/DappLogToaster.tsx";
import { useUi } from "../../providers/UiProvider.tsx";

/** Frame: collapsible sidebar + main column. Top bar / wallet drawer live in route host. */
export function AppShell(props: { children: ReactNode }) {
  const { sidebarCollapsed, shellReady } = useUi();

  return (
    <div
      className={`app-frame${sidebarCollapsed || !shellReady ? " sidebar-collapsed" : ""}${
        !shellReady ? " session-locked" : ""
      }`}
    >
      <div className="void-glow" aria-hidden="true" />
      {shellReady ? <Sidebar /> : null}
      <div className="app-main-column">{props.children}</div>
      <DappLogToaster />
    </div>
  );
}
