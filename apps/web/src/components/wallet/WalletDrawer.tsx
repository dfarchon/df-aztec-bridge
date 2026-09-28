import { QRCodeSVG } from "qrcode.react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ConnectedWallet, EIP6963ProviderDetail } from "@df-bridge/browser-sdk";
import { WalletManagerPanel } from "../../modules/wallet/WalletManagerPanel.tsx";
import { useUi } from "../../providers/UiProvider.tsx";
import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import type { RpcOverrides } from "../../lib/rpc-overrides.ts";

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
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!walletPanelOpen) {
      setMinimized(false);
    }
  }, [walletPanelOpen]);

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const maxX = Math.max(8, window.innerWidth - drag.w - 8);
    const maxY = Math.max(8, window.innerHeight - 48);
    setPos({
      x: Math.min(maxX, Math.max(8, event.clientX - drag.dx)),
      y: Math.min(maxY, Math.max(8, event.clientY - drag.dy)),
    });
  };

  const onDragEnd = () => {
    dragRef.current = null;
  };

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
                {props.wcProjectId
                  ? "Browser extensions (EIP-6963) or mobile QR (WalletConnect)."
                  : "Browser extensions detected via EIP-6963."}
              </p>
              <p className="hint">
                After you pick MetaMask, check the fox icon for a connect prompt (it may not
                appear if the extension popup is already open — close it first).
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
                        <span className="rdns">{w.info.rdns}</span>
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
      {walletPanelOpen && typeof document !== "undefined"
        ? createPortal(
        <div className="wallet-float-root" role="presentation">
          <aside
            ref={panelRef}
            className={`wallet-float-panel${minimized ? " is-min" : ""}`}
            role="dialog"
            aria-modal="false"
            aria-labelledby="wallet-drawer-title"
            style={pos == null ? undefined : { left: pos.x, top: pos.y, transform: "none" }}
          >
            <div
              className="wallet-float-head"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <p className="label" id="wallet-drawer-title">
                // wallet manager
              </p>
              <div className="wallet-float-controls">
                <button
                  type="button"
                  className="icon-btn utility-control"
                  aria-label={minimized ? "Restore wallet manager" : "Minimize wallet manager"}
                  title={minimized ? "Restore" : "Minimize"}
                  onClick={() => {
                    setMinimized((v) => !v);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path fill="currentColor" d="M5 13h14v2H5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="icon-btn utility-control"
                  aria-label="Close wallet manager"
                  title="Close"
                  onClick={closeWalletPanel}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {minimized ? null : (
            <div className="wallet-drawer-body">
              <WalletManagerPanel
                networkId={props.networkId}
                rpcOverrides={props.rpcOverrides}
                aztecNodeUrl={props.aztecNodeUrl}
                browserClaimEnabled={BROWSER_CLAIM}
                busy={props.busy || !!props.connectingWallet}
                ethWallet={props.ethWallet}
                dfpunkPlayUrl={DFPUNK_PLAY_URL}
                onEthSessionValidated={props.onEthSessionValidated}
                onConnectEth={props.onConnectEth}
                onDisconnectEth={props.onDisconnectEth}
                onApplyAztecAccount={props.onApplyAztecAccount}
                onClearAztecAccount={props.onClearAztecAccount}
              />
              {props.connectError ? <p className="error small">{props.connectError}</p> : null}
            </div>
            )}
          </aside>
        </div>,
        document.body,
      )
        : null}
      {picker}
    </>
  );
}
