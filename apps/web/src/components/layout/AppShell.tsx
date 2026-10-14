import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.tsx";
import { DAPP_LOG_ENABLED } from "../../lib/dapp-log.ts";
import { AppErrorToaster } from "../ui/AppErrorToaster.tsx";
import { DappLogToaster } from "../ui/DappLogToaster.tsx";
import { useUi } from "../../providers/UiProvider.tsx";
import { AsciiField } from "../../theme/AsciiField.tsx";
import { SoundSystem } from "../../theme/ThemeSoundControls.tsx";
import { ThemeTooltip } from "../../theme/ThemeTooltip.tsx";

/** Frame: full-width header, then sidebar + main below. */
export function AppShell(props: { children: ReactNode }) {
  const { shellReady } = useUi();

  return (
    <div className={`app-frame${!shellReady ? " session-locked" : ""}`}>
      <AsciiField />
      <SoundSystem />
      <div className="app-main-column">
        {props.children}
        {shellReady ? <Sidebar /> : null}
      </div>
      <AppErrorToaster />
      {DAPP_LOG_ENABLED ? <DappLogToaster /> : null}
      <ThemeTooltip />
    </div>
  );
}
