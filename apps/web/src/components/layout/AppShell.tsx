import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.tsx";
import { DappLogToaster } from "../ui/DappLogToaster.tsx";
import { useUi } from "../../providers/UiProvider.tsx";
import { AsciiField } from "../../theme/AsciiField.tsx";
import { SoundSystem } from "../../theme/ThemeSoundControls.tsx";
import { ThemeTooltip } from "../../theme/ThemeTooltip.tsx";

/** Frame: collapsible sidebar + main column. Top bar / wallet drawer live in route host. */
export function AppShell(props: { children: ReactNode }) {
  const { shellReady } = useUi();

  return (
    <div
      className={`app-frame${!shellReady ? " sidebar-collapsed session-locked" : ""}`}
    >
      <AsciiField />
      <SoundSystem />
      <div className="identity-scanlines" aria-hidden="true" />
      {shellReady ? <Sidebar /> : null}
      <div className="app-main-column">{props.children}</div>
      <DappLogToaster />
      <ThemeTooltip />
    </div>
  );
}
