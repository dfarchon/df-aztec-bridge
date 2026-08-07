import { useRef, useState } from "react";
import { DFPUNK_PLAY_URL_DEFAULT } from "../../lib/df-client-links.ts";
import { useUi } from "../../providers/UiProvider.tsx";
import { pushDappLog } from "../../lib/dapp-log.ts";

/**
 * Centered gate when MetaMask/WalletConnect + DF Punk PXE are not ready.
 * Shell frame / TopBar / Wallets chip stay visible; menus and route bodies are hidden.
 */
export function ConnectSessionGate(props: {
  ethConnected: boolean;
  ethSessionOk: boolean;
  pxeReady: boolean;
  dfpunkPlayUrl?: string;
  /** When ETH session is OK, allow picking dfpunk-account JSON here (step 2). */
  canImportPxe?: boolean;
  importingPxe?: boolean;
  onImportPxeFile?: (file: File) => void | Promise<void>;
  importError?: string | null;
}) {
  const { openWalletPanel } = useUi();
  const playUrl = props.dfpunkPlayUrl ?? DFPUNK_PLAY_URL_DEFAULT;
  const fileRef = useRef<HTMLInputElement>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const step1Done = props.ethConnected && props.ethSessionOk;
  const step2Done = props.pxeReady;
  const importing = props.importingPxe || localBusy;
  const canImport = !!props.canImportPxe && !!props.onImportPxeFile && !importing;

  const pickFile = () => {
    if (!canImport) {
      openWalletPanel();
      pushDappLog({
        kind: "info",
        title: "Open Wallets",
        detail: step1Done
          ? "Use Import from DF client → PXE in the wallet panel."
          : "Connect and validate MetaMask / WalletConnect first.",
        ttlMs: 8_000,
      });
      return;
    }
    fileRef.current?.click();
  };

  return (
    <section className="connect-gate" aria-label="Connect wallets to continue">
      <div className="connect-gate-card">
        <p className="label">df/archon · session</p>
        <h2 className="connect-gate-title">Connect to unlock the bridge</h2>
        <p className="muted small connect-gate-lead">
          Menus and bridge tools stay hidden until a validated Web3 connector and a DF Punk
          account imported into PXE are ready.
        </p>

        <ol className="connect-gate-steps">
          <li className={step1Done ? "is-done" : ""}>
            <span className="connect-gate-step-mark mono" aria-hidden="true">
              {step1Done ? "✓" : "1"}
            </span>
            <div>
              <strong>Ethereum wallet</strong>
              <p className="hint">
                Connect MetaMask (EIP-6963) or WalletConnect and wait for session validation.
              </p>
            </div>
          </li>
          <li className={step2Done ? "is-done" : ""}>
            <span className="connect-gate-step-mark mono" aria-hidden="true">
              {step2Done ? "✓" : "2"}
            </span>
            <div>
              <strong>DF Punk → PXE</strong>
              <p className="hint">
                In{" "}
                <a href={playUrl} target="_blank" rel="noopener noreferrer">
                  DF client
                </a>
                , download account info (<span className="mono">dfpunk-account-*.json</span>),
                then import into PXE. Bridge unlocks only for that bound account.
              </p>
            </div>
          </li>
        </ol>

        {props.importError ? <p className="error small">{props.importError}</p> : null}

        <div className="connect-gate-actions">
          {!step1Done ? (
            <button type="button" className="primary connect-gate-cta" onClick={openWalletPanel}>
              Open Wallets
            </button>
          ) : !step2Done ? (
            <>
              <button
                type="button"
                className="primary connect-gate-cta"
                disabled={!canImport && !props.onImportPxeFile}
                onClick={pickFile}
              >
                {importing ? "Importing into PXE…" : "Import DF Punk JSON → PXE"}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                accept=".json,application/json"
                aria-label="Import dfpunk-account JSON into PXE"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (!f || !props.onImportPxeFile) return;
                  setLocalBusy(true);
                  void Promise.resolve(props.onImportPxeFile(f)).finally(() => setLocalBusy(false));
                }}
              />
              <button type="button" className="ghost connect-gate-cta" onClick={openWalletPanel}>
                Open Wallets panel
              </button>
            </>
          ) : (
            <p className="hint storage-status-ok">Session ready — unlocking menus…</p>
          )}
        </div>
      </div>
    </section>
  );
}
