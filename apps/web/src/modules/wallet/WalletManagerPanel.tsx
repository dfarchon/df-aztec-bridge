import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import { assertDfClientAccount } from "../../lib/account-import.ts";
import { isBridgeReadyDfPxeAccount } from "../../lib/df-pxe-bridge-guard.ts";
import {
  getActiveAztecWallet,
  listStoredAztecWallets,
  removeAztecWallet,
  saveAztecWallet,
} from "../../lib/aztec-wallet-store.ts";
import {
  aztecBackupFilename,
  downloadTextFile,
  serializeAztecWalletTxt,
} from "../../lib/wallet-backup.ts";
import { shortHash } from "../../lib/claim-recovery.ts";
import { DFPUNK_PLAY_URL_DEFAULT } from "../../lib/df-client-links.ts";
import { getNetwork, l1ChainLabel } from "../../config/networks.ts";
import {
  isTrustedConnector,
  tryValidateConnectedWalletSession,
} from "../../lib/wallet-session-guard.ts";
import { logDappError, pushDappLog } from "../../lib/dapp-log.ts";
import { hasRpcOverrides, type RpcOverrides } from "../../lib/rpc-overrides.ts";
import { useVault } from "../../providers/VaultProvider.tsx";
import { isVaultUnlocked } from "../../lib/vault.ts";
import {
  importDfPunkFileIntoPxe,
  registerDfPunkAccountIntoPxe,
} from "../../lib/df-pxe-import.ts";
import { ConnectNoticeHostContext } from "../../components/ui/ConnectSessionGate.tsx";

export function WalletManagerPanel(props: {
  networkId: string;
  rpcOverrides: RpcOverrides;
  aztecNodeUrl: string | null;
  browserClaimEnabled: boolean;
  busy: boolean;
  ethWallet: ConnectedWallet | null;
  dfpunkPlayUrl?: string;
  /** Called when ETH session validates or fails (parent can clear bridge unlock). */
  onEthSessionValidated?: (ok: boolean) => void;
  onConnectEth: () => void;
  onDisconnectEth: () => void;
  onApplyAztecAccount: (account: ImportedAztecAccount) => void;
  onClearAztecAccount?: () => void;
}) {
  const {
    networkId,
    rpcOverrides,
    aztecNodeUrl,
    browserClaimEnabled,
    busy,
    ethWallet,
    dfpunkPlayUrl = DFPUNK_PLAY_URL_DEFAULT,
    onEthSessionValidated,
    onConnectEth,
    onDisconnectEth,
    onApplyAztecAccount,
    onClearAztecAccount,
  } = props;

  const {
    requireVaultAfterPxeImport,
    ensureUnlocked,
    unlockExistingVault,
    vaultAvailable,
    refreshVaultAvailability,
    secretsVisible,
    requestUnlock,
    unlocked,
  } = useVault();

  const [aztecAccounts, setAztecAccounts] = useState<ImportedAztecAccount[]>(
    [],
  );
  const [activeAztec, setActiveAztec] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importingPxe, setImportingPxe] = useState(false);
  const [unlockingVault, setUnlockingVault] = useState(false);
  const [sessionOk, setSessionOk] = useState(false);
  const [sessionReason, setSessionReason] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const dfImportInputRef = useRef<HTMLInputElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  /** Bumped on disconnect so in-flight PXE progress cannot repaint notices. */
  const noticeEpoch = useRef(0);

  const dropSessionNotices = useCallback(() => {
    noticeEpoch.current += 1;
    setStatus(null);
    setError(null);
    setFormatOpen(false);
    setImportingPxe(false);
    setUnlockingVault(false);
  }, []);

  useEffect(() => {
    if (ethWallet) return;
    dropSessionNotices();
  }, [ethWallet, dropSessionNotices]);

  const refresh = useCallback(async () => {
    if (!isVaultUnlocked()) {
      setAztecAccounts([]);
      setActiveAztec(null);
      return;
    }
    setAztecAccounts(await listStoredAztecWallets());
    setActiveAztec(await getActiveAztecWallet());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, unlocked]);

  useEffect(() => {
    void refreshVaultAvailability();
  }, [refreshVaultAvailability]);

  /** Continuously validate connector; DF PXE UI stays locked until this passes. */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!ethWallet) {
        if (!cancelled) {
          setSessionOk(false);
          setSessionReason("Connect a wallet to continue.");
          onEthSessionValidated?.(false);
        }
        return;
      }
      if (!isTrustedConnector(ethWallet)) {
        if (!cancelled) {
          setSessionOk(false);
          setSessionReason(
            "This wallet can't be used. Connect MetaMask or WalletConnect.",
          );
          onEthSessionValidated?.(false);
        }
        return;
      }
      const result = await tryValidateConnectedWalletSession(ethWallet);
      if (cancelled) return;
      if (result.ok) {
        setSessionOk(true);
        setSessionReason(null);
        onEthSessionValidated?.(true);
      } else {
        setSessionOk(false);
        setSessionReason(result.reason);
        onEthSessionValidated?.(false);
      }
    };
    void run();
    const id = window.setInterval(() => void run(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ethWallet, onEthSessionValidated]);

  const expectedNetwork = (() => {
    try {
      return getNetwork(networkId);
    } catch {
      return null;
    }
  })();
  const expectedL1ChainId = expectedNetwork?.l1ChainId ?? null;
  const expectedL1Name =
    expectedL1ChainId != null ? l1ChainLabel(expectedL1ChainId) : null;

  const copyEthAddress = useCallback(async () => {
    if (!ethWallet) return;
    try {
      await navigator.clipboard.writeText(ethWallet.address);
      setAddressCopied(true);
      if (copyResetTimerRef.current)
        window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(
        () => setAddressCopied(false),
        2_000,
      );
    } catch {
      setError("Could not copy the address. Copy it from your wallet instead.");
    }
  }, [ethWallet]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current)
        window.clearTimeout(copyResetTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!formatOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFormatOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [formatOpen]);

  const backupAztecTxt = (account: ImportedAztecAccount) => {
    const txt = serializeAztecWalletTxt(account, { networkId });
    downloadTextFile(aztecBackupFilename(account.address), txt);
    setStatus(
      `Aztec wallet backup downloaded — keep ${aztecBackupFilename(account.address)} secret.`,
    );
  };

  const importFromDfClientIntoPxe = async (file: File | null) => {
    if (!file) return;
    if (!sessionOk || !ethWallet) {
      setError("Connect a wallet first.");
      return;
    }
    if (!browserClaimEnabled) {
      setError("Account import isn't available in this browser.");
      return;
    }
    if (!aztecNodeUrl) {
      setError("Select a network first.");
      return;
    }

    const epoch = noticeEpoch.current;
    const live = () => noticeEpoch.current === epoch;
    setImportingPxe(true);
    setError(null);
    setStatus(`Validating connector + reading DF export ${file.name}…`);
    try {
      const stored = await importDfPunkFileIntoPxe({
        file,
        ethWallet,
        networkId,
        aztecNodeUrl,
        onProgress: (detail) => {
          if (live()) setStatus(detail);
        },
      });
      if (!live()) return;
      await requireVaultAfterPxeImport(stored);
      if (!live()) return;
      const ok = await ensureUnlocked("secrets", stored);
      if (!live()) return;
      if (!ok) throw new Error("Vault password required after PXE import.");
      await saveAztecWallet(stored);
      if (!live()) return;
      await refreshVaultAvailability();
      await refresh();
      if (!live()) return;
      onApplyAztecAccount(stored);
      const readyMsg = `DF Punk PXE ready for ${shortHash(stored.address)} (bound to ${shortHash(stored.boundEthAddress ?? ethWallet.address)}). Bridge unlocked.`;
      setStatus(readyMsg);
      pushDappLog({
        kind: "announce",
        title: "DF Punk PXE session ready",
        detail: readyMsg,
      });
    } catch (e: unknown) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logDappError(e, "Import DF Punk → PXE failed");
    } finally {
      if (live()) setImportingPxe(false);
    }
  };

  const unlockPxeFromIndexedDb = async () => {
    if (!sessionOk || !ethWallet) {
      setError("Connect a wallet first.");
      return;
    }
    if (!browserClaimEnabled) {
      setError("Account import isn't available in this browser.");
      return;
    }
    if (!aztecNodeUrl) {
      setError("Select a network first.");
      return;
    }

    const epoch = noticeEpoch.current;
    const live = () => noticeEpoch.current === epoch;
    setUnlockingVault(true);
    setError(null);
    setStatus("Unlocking IndexedDB vault…");
    try {
      const restored = await unlockExistingVault();
      if (!live()) return;
      if (!restored) throw new Error("Vault unlock cancelled.");
      assertDfClientAccount(restored);
      let stored: ImportedAztecAccount = { ...restored, fromDfClient: true };
      if (restored.pxeRegistered) {
        setStatus("Vault unlocked — using the saved PXE account.");
      } else {
        setStatus("Restoring DF Punk wallet into PXE…");
        try {
          stored = await registerDfPunkAccountIntoPxe({
            account: stored,
            ethWallet,
            networkId,
            aztecNodeUrl,
            onProgress: (detail) => {
              if (live()) setStatus(detail);
            },
          });
        } catch (err: unknown) {
          if (!live()) return;
          const message = err instanceof Error ? err.message : String(err);
          if (!/derive/i.test(message)) throw err;
          setStatus(
            "Vault unlocked with the saved address. PXE re-registration derived a different address — use Quick Join for this session, or re-import the DF JSON if a claim fails.",
          );
        }
      }
      if (!live()) return;
      await saveAztecWallet(stored);
      if (!live()) return;
      await refresh();
      if (!live()) return;
      onApplyAztecAccount(stored);
      const readyMsg = `PXE restored from IndexedDB for ${shortHash(stored.address)} (bound to ${shortHash(ethWallet.address)}).`;
      setStatus(readyMsg);
      pushDappLog({
        kind: "announce",
        title: "Vault unlocked → PXE ready",
        detail: readyMsg,
      });
    } catch (e: unknown) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logDappError(e, "Unlock PXE IndexedDB failed");
    } finally {
      if (live()) setUnlockingVault(false);
    }
  };

  const blocked = busy || importingPxe || unlockingVault;
  const dfUnlocked = sessionOk && !!ethWallet && browserClaimEnabled;

  const bridgeReadyAccounts = aztecAccounts.filter((a) =>
    isBridgeReadyDfPxeAccount(a, ethWallet?.address),
  );
  const noticeHost = useContext(ConnectNoticeHostContext);

  const sessionNotice =
    ethWallet && (status || error) ? (
      <div className="wallet-manager-notices">
        {status ? (
          <div className="wallet-manager-notice" role="status">
            <p>{status}</p>
            <button
              type="button"
              className="wallet-manager-notice-close"
              aria-label="Dismiss"
              onClick={() => setStatus(null)}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                />
              </svg>
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="wallet-manager-notice is-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="wallet-manager-notice-close"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <>
    <div className="wallet-manager-layout">
    <section className="card wallet-manager" aria-label="Wallet">
      {hasRpcOverrides(rpcOverrides) ? (
        <p className="hint">
          Custom RPC is on. Check the host before you sign.
        </p>
      ) : null}

      <div
        className={`wallet-manager-grid${dfUnlocked ? "" : " wallet-manager-grid-solo"}`}
      >
        <div className={`wallet-manager-col${ethWallet ? "" : " is-connect"}`}>
          {ethWallet ? (
            <p className="wallet-manager-pane-title">Ethereum L1</p>
          ) : null}
          {ethWallet ? (
            <>
              <div className="wallet-manager-address">
                <span className="wallet-manager-address-text">
                  {shortHash(ethWallet.address)}
                </span>
                <button
                  type="button"
                  className="copy-address-btn"
                  aria-label={addressCopied ? "Address copied" : "Copy address"}
                  onClick={() => void copyEthAddress()}
                >
                  {addressCopied ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M9.2 16.6 4.8 12.2l1.4-1.4 3 3 8.6-8.6 1.4 1.4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M8 7V5c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2h-2v2c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h2Zm2 0h5c1.1 0 2 .9 2 2v5h2V5h-9v2Zm-4 2v9h9V9H6Z"
                      />
                    </svg>
                  )}
                </button>
              </div>
              {expectedL1ChainId != null &&
              ethWallet.chainId !== expectedL1ChainId ? (
                <p className="error">
                  Switch your wallet to{" "}
                  {expectedL1Name ?? "the correct network"}.
                </p>
              ) : null}
              {sessionOk ? null : (
                <p className="error">
                  {sessionReason ?? "Couldn't confirm this wallet. Try again."}
                </p>
              )}
              <div className="wallet-manager-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={onConnectEth}
                >
                  Switch
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    dropSessionNotices();
                    onClearAztecAccount?.();
                    onDisconnectEth();
                  }}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <button type="button" disabled={blocked} onClick={onConnectEth}>
              Connect wallet
            </button>
          )}
        </div>

        {dfUnlocked ? (
          <div className="wallet-manager-col">
            {formatOpen ? (
              <div className="df-pxe-format-pane">
                <p className="wallet-manager-pane-title">What file is this?</p>
                <p className="hint df-pxe-import-steps">
                  A JSON export named <span className="mono">dfpunk-account-*.json</span>.
                </p>
                <p className="hint df-pxe-import-steps">
                  Get it from Dark Forest Aztec → Settings → Download account info. It looks like:
                </p>
                <pre className="df-pxe-format-sample">{`{
  "address": "0x…",
  "secretKey": "0x…",
  "salt": "0x…",
  "signingKey": "0x…"
}`}</pre>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setFormatOpen(false)}
                >
                  Back
                </button>
              </div>
            ) : null}
            <div
              className={`wallet-manager-col-body${formatOpen ? " is-hidden" : ""}`}
              aria-hidden={formatOpen}
            >
            <p className="wallet-manager-pane-title">Aztec L2</p>
            <div className="df-pxe-import">
              <p className="hint df-pxe-import-steps">
                The account you bridge to is the one you already use in{" "}
                <a
                  href={dfpunkPlayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Dark Forest Aztec
                </a>
                .
              </p>
              <p className="hint df-pxe-import-steps">
                In the game, open Settings and choose Download account info,
                then pick that file here.
              </p>
              {vaultAvailable ? (
                <>
                  <button
                    type="button"
                    className={`df-pxe-import-btn${ethWallet && sessionOk && !blocked ? " cta-pulse" : ""}`}
                    disabled={blocked}
                    onClick={() => void unlockPxeFromIndexedDb()}
                  >
                    {unlockingVault ? "Unlocking…" : "Unlock"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={blocked}
                    onClick={() => dfImportInputRef.current?.click()}
                  >
                    Import a file
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="df-pxe-import-btn"
                  disabled={blocked}
                  onClick={() => dfImportInputRef.current?.click()}
                >
                  {importingPxe ? "Importing…" : "Import account"}
                </button>
              )}
              <button
                type="button"
                className="df-pxe-import-format-toggle"
                aria-expanded={false}
                onClick={() => setFormatOpen(true)}
              >
                What file is this?
              </button>
              <input
                ref={dfImportInputRef}
                type="file"
                className="sr-only"
                accept=".json,application/json"
                disabled={blocked}
                aria-label="Import dfpunk-account JSON from DF client into PXE"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  void importFromDfClientIntoPxe(f);
                  e.target.value = "";
                }}
              />
            </div>

            {bridgeReadyAccounts.length === 0 ? null : !secretsVisible ? (
              <button type="button" className="primary" onClick={requestUnlock}>
                Unlock to view
              </button>
            ) : (
              <ul className="wallet-manager-list">
                {bridgeReadyAccounts.map((a) => {
                  const isActive =
                    activeAztec?.toLowerCase() === a.address.toLowerCase();
                  return (
                    <li
                      key={a.address}
                      className={isActive ? "active" : undefined}
                    >
                      <button
                        type="button"
                        className="ghost wallet-manager-pick"
                        disabled={blocked}
                        onClick={() => {
                          void (async () => {
                            const ok = await ensureUnlocked("secrets");
                            if (!ok) return;
                            await saveAztecWallet(a);
                            onApplyAztecAccount(a);
                            setStatus(
                              `Bridge recipient locked to DF PXE ${shortHash(a.address)}`,
                            );
                            await refresh();
                          })();
                        }}
                      >
                        <span className="mono">{shortHash(a.address)}</span>
                        <span className="hint">
                          {a.label ?? "DF"} · PXE · bound
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={blocked}
                        title="Download secret backup .txt"
                        onClick={() => backupAztecTxt(a)}
                      >
                        .txt
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={blocked}
                        title="Remove from this browser"
                        onClick={() => {
                          void (async () => {
                            const ok = await ensureUnlocked("secrets");
                            if (!ok) return;
                            await removeAztecWallet(a.address);
                            onClearAztecAccount?.();
                            await refresh();
                            setStatus("Removed DF PXE wallet binding.");
                          })();
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
    {noticeHost === undefined ? sessionNotice : null}
    </div>
    {noticeHost && sessionNotice ? createPortal(sessionNotice, noticeHost) : null}
    </>
  );
}
