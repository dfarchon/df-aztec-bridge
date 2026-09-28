import { shortHash } from "../../lib/claim-recovery.ts";
import { SoundMenu, ThemeToggle } from "../../theme/ThemeSoundControls.tsx";
import { hasRpcOverrides } from "../../lib/rpc-overrides.ts";
import { useUi } from "../../providers/UiProvider.tsx";
import { useNetwork } from "../../providers/NetworkProvider.tsx";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";

export function TopBar(props: {
  wallet: ConnectedWallet | null;
  ethSessionOk: boolean;
  onConnect: () => void;
  /** When false, hide menu toggle / settings — session gate is active. */
  shellReady?: boolean;
}) {
  const { toggleSidebar, sidebarCollapsed, openWalletPanel, walletPanelOpen } = useUi();
  const { openSettings, rpcOverrides } = useNetwork();
  const shellReady = props.shellReady !== false;

  return (
    <header className="app-topbar">
      <div className="app-topbar-left">
        {shellReady && sidebarCollapsed ? (
          <button
            type="button"
            className="ghost app-topbar-menu"
            onClick={toggleSidebar}
            title="Show menu"
            aria-label="Show menu"
          >
            Menu
          </button>
        ) : null}
      </div>

      <div className="app-topbar-brand">
        <p className="label brand-kicker">df/archon · fee juice</p>
        <h1 className="app-topbar-title">DF Aztec Bridge</h1>
      </div>

      <div className="app-topbar-right">
        <ThemeToggle />
        <SoundMenu />
        {shellReady ? (
          <button
            type="button"
            className={`icon-btn settings-btn${hasRpcOverrides(rpcOverrides) ? " active" : ""}`}
            aria-label="RPC settings"
            title="RPC settings"
            onClick={openSettings}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.07 7.07 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.65 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.77 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          className={`wallet-chip${walletPanelOpen ? " is-open" : ""}${props.ethSessionOk ? " is-ok" : ""}`}
          onClick={() => {
            if (!props.wallet) props.onConnect();
            openWalletPanel();
          }}
          aria-expanded={walletPanelOpen}
          aria-haspopup="dialog"
        >
          <span
            className={`wallet-chip-dot${props.ethSessionOk ? " ok" : ""}`}
            aria-hidden="true"
          />
          <span className="wallet-chip-label mono">
            {props.wallet ? shortHash(props.wallet.address) : "Wallets"}
          </span>
        </button>
      </div>
    </header>
  );
}
