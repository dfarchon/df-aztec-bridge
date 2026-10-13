import { QRCodeSVG } from "qrcode.react";
import { createPortal } from "react-dom";
import { useEffect, useState, type RefObject } from "react";
import type { ConnectedWallet, EIP6963ProviderDetail } from "@df-bridge/browser-sdk";
import { WalletManagerPanel } from "../../modules/wallet/WalletManagerPanel.tsx";
import { useUi } from "../../providers/UiProvider.tsx";
import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import type { RpcOverrides } from "../../lib/rpc-overrides.ts";
import {
  getActiveAztecWallet,
  listStoredAztecWallets,
} from "../../lib/aztec-wallet-store.ts";
import { isVaultUnlocked } from "../../lib/vault.ts";

const DFPUNK_PLAY_URL =
  (import.meta.env.VITE_DFPUNK_PLAY_URL as string | undefined)?.trim() ||
  "https://aztec.dfpunk.xyz/play/";
const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM !== "false";

export function WalletDrawer(props: {
  networkId: string;
  rpcOverrides: RpcOverrides;
  aztecNodeUrl: string | null;
  busy: boolean;
  connectingWallet?: boolean;
  connectError?: string | null;
  ethWallet: ConnectedWallet | null;
  ethSessionOk?: boolean;
  onEthSessionValidated: (ok: boolean) => void;
  onConnectEth: () => void;
  onDisconnectEth: () => void;
  onApplyAztecAccount: (account: ImportedAztecAccount) => void;
  onClearAztecAccount: () => void;
  pickerOpen: boolean;
  availableWallets: EIP6963ProviderDetail[];
  connectDetail: (detail: EIP6963ProviderDetail) => void;
  onConnectWalletConnect: () => void;
  closeWalletPicker: () => void;
  wcUri: string | null;
  walletPickerRef: RefObject<HTMLDivElement | null>;
  wcProjectId: string;
  hasNetwork: boolean;
}) {
  const { walletPanelOpen, closeWalletPanel } = useUi();
  const pickerBusy = props.busy || !!props.connectingWallet;
  const [storedWallets, setStoredWallets] = useState<{
    accounts: ImportedAztecAccount[];
    active: string | null;
  } | null>(null);

  useEffect(() => {
    if (!walletPanelOpen) {
      setStoredWallets(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!isVaultUnlocked()) {
        if (!cancelled) setStoredWallets({ accounts: [], active: null });
        return;
      }
      const [accounts, active] = await Promise.all([
        listStoredAztecWallets(),
        getActiveAztecWallet(),
      ]);
      if (!cancelled) setStoredWallets({ accounts, active });
    })();
    return () => {
      cancelled = true;
    };
  }, [walletPanelOpen]);

  useEffect(() => {
    if (!walletPanelOpen || !storedWallets) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeWalletPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [walletPanelOpen, storedWallets, closeWalletPanel]);

  const picker =
    props.pickerOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="modal-backdrop wallet-picker-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget && !props.connectingWallet) {
                props.closeWalletPicker();
              }
            }}
          >
            <div
              ref={props.walletPickerRef}
              className="modal wallet-picker-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="wallet-picker-title"
              tabIndex={-1}
            >
              <div className="modal-header">
                <strong id="wallet-picker-title">Choose wallet</strong>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close wallet picker"
                  title="Close"
                  disabled={!!props.connectingWallet}
                  onClick={props.closeWalletPicker}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                    />
                  </svg>
                </button>
              </div>
              <p className="hint">
                Choose a wallet, then approve the request in its popup. If nothing appears, close
                any wallet window that's already open.
              </p>
              {props.connectError ? <p className="error small">{props.connectError}</p> : null}
              {props.connectingWallet ? (
                <p className="hint storage-status-ok">Waiting for wallet approval…</p>
              ) : null}
              {props.availableWallets.length > 0 ? (
                <ul className="wallet-list">
                  {props.availableWallets.map((w) => (
                    <li key={w.info.rdns}>
                      <button
                        type="button"
                        className="wallet-option"
                        disabled={pickerBusy}
                        onClick={() => props.connectDetail(w)}
                      >
                        {w.info.icon ? (
                          <img src={w.info.icon} alt="" width={28} height={28} />
                        ) : null}
                        <span>{w.info.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">No browser extension detected.</p>
              )}
              {props.wcProjectId ? (
                <>
                  <button
                    type="button"
                    className="wallet-option wc"
                    disabled={pickerBusy || !props.hasNetwork}
                    onClick={() => props.onConnectWalletConnect()}
                  >
                    <span>Scan QR with mobile wallet</span>
                    <span className="rdns">WalletConnect</span>
                  </button>
                  {props.wcUri ? (
                    <div className="qr-box">
                      <QRCodeSVG
                        value={props.wcUri}
                        size={220}
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                      <p className="hint">Open MetaMask / OKX / Trust on your phone → Scan QR</p>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={!!props.connectingWallet}
                  onClick={props.closeWalletPicker}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {walletPanelOpen && storedWallets && typeof document !== "undefined"
        ? createPortal(
        <div
          className="wallet-float-root"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeWalletPanel();
          }}
        >
          <aside
            className="wallet-float-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-drawer-title"
          >
            <div className="wallet-float-head">
              <p className="wallet-float-title" id="wallet-drawer-title">
                Account management
              </p>
              <button
                type="button"
                className="icon-btn wallet-float-close"
                aria-label="Close"
                title="Close"
                onClick={closeWalletPanel}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                  />
                </svg>
              </button>
            </div>
            <div className="wallet-drawer-body">
              <WalletManagerPanel
                networkId={props.networkId}
                rpcOverrides={props.rpcOverrides}
                aztecNodeUrl={props.aztecNodeUrl}
                browserClaimEnabled={BROWSER_CLAIM}
                busy={props.busy || !!props.connectingWallet}
                ethWallet={props.ethWallet}
                dfpunkPlayUrl={DFPUNK_PLAY_URL}
                initialAztecAccounts={storedWallets.accounts}
                initialActiveAztec={storedWallets.active}
                ethSessionOk={props.ethSessionOk}
                onEthSessionValidated={props.onEthSessionValidated}
                onConnectEth={props.onConnectEth}
                onDisconnectEth={props.onDisconnectEth}
                onApplyAztecAccount={props.onApplyAztecAccount}
                onClearAztecAccount={props.onClearAztecAccount}
              />
              {props.connectError ? <p className="error small">{props.connectError}</p> : null}
            </div>
          </aside>
        </div>,
        document.body,
      )
        : null}
      {picker}
    </>
  );
}
