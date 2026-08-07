import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import type { ImportedAztecAccount } from "../../lib/account-import.ts";
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
  ethBackupFilename,
  serializeAztecWalletTxt,
  serializeEthWalletTxt,
} from "../../lib/wallet-backup.ts";
import { shortHash } from "../../lib/claim-recovery.ts";
import { DFPUNK_PLAY_URL_DEFAULT } from "../../lib/df-client-links.ts";
import {
  isTrustedConnector,
  tryValidateConnectedWalletSession,
} from "../../lib/wallet-session-guard.ts";
import { logDappError, pushDappLog } from "../../lib/dapp-log.ts";
import { useVault } from "../../providers/VaultProvider.tsx";
import { isVaultUnlocked } from "../../lib/vault.ts";
import { importDfPunkFileIntoPxe } from "../../lib/df-pxe-import.ts";

export function WalletManagerPanel(props: {
  networkId: string;
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

  const { requireVaultAfterPxeImport, ensureUnlocked, secretsVisible, requestUnlock, unlocked } =
    useVault();

  const [aztecAccounts, setAztecAccounts] = useState<ImportedAztecAccount[]>([]);
  const [activeAztec, setActiveAztec] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importingPxe, setImportingPxe] = useState(false);
  const [sessionOk, setSessionOk] = useState(false);
  const [sessionReason, setSessionReason] = useState<string | null>(null);
  const dfImportInputRef = useRef<HTMLInputElement>(null);

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

  /** Continuously validate connector; DF PXE UI stays locked until this passes. */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!ethWallet) {
        if (!cancelled) {
          setSessionOk(false);
          setSessionReason("Connect MetaMask (EIP-6963) or WalletConnect to unlock DF Punk PXE.");
          onEthSessionValidated?.(false);
        }
        return;
      }
      if (!isTrustedConnector(ethWallet)) {
        if (!cancelled) {
          setSessionOk(false);
          setSessionReason(
            "This provider is not a trusted connector (legacy window.ethereum inject blocked). Use MetaMask via EIP-6963 or WalletConnect.",
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

  const backupEthTxt = () => {
    if (!ethWallet || !sessionOk) return;
    const txt = serializeEthWalletTxt({
      address: ethWallet.address,
      chainId: ethWallet.chainId,
      walletName: ethWallet.name,
      networkId,
    });
    downloadTextFile(ethBackupFilename(ethWallet.address), txt);
    setStatus("Ethereum address snapshot downloaded (.txt).");
  };

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
      setError("Validate MetaMask / WalletConnect first — DF Punk PXE stays locked.");
      return;
    }
    if (!browserClaimEnabled) {
      setError("Browser PXE is disabled — cannot register the DF account in PXE.");
      return;
    }
    if (!aztecNodeUrl) {
      setError("Select a network with an Aztec node URL first.");
      return;
    }

    setImportingPxe(true);
    setError(null);
    setStatus(`Validating connector + reading DF export ${file.name}…`);
    try {
      const stored = await importDfPunkFileIntoPxe({
        file,
        ethWallet,
        networkId,
        aztecNodeUrl,
        onProgress: (detail) => setStatus(detail),
      });
      await requireVaultAfterPxeImport(stored);
      const ok = await ensureUnlocked("secrets", stored);
      if (!ok) throw new Error("Vault password required after PXE import.");
      await saveAztecWallet(stored);
      await refresh();
      onApplyAztecAccount(stored);
      const readyMsg = `DF Punk PXE ready for ${shortHash(stored.address)} (bound to ${shortHash(stored.boundEthAddress ?? ethWallet.address)}). Bridge unlocked.`;
      setStatus(readyMsg);
      pushDappLog({
        kind: "announce",
        title: "DF Punk PXE session ready",
        detail: readyMsg,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logDappError(e, "Import DF Punk → PXE failed");
    } finally {
      setImportingPxe(false);
    }
  };

  const blocked = busy || importingPxe;
  const dfUnlocked = sessionOk && !!ethWallet && browserClaimEnabled;

  const bridgeReadyAccounts = aztecAccounts.filter((a) =>
    isBridgeReadyDfPxeAccount(a, ethWallet?.address),
  );

  return (
    <section className="card wallet-manager" aria-label="Wallet manager">
      <strong>Wallet manager</strong>
      <p className="hint">
        {dfUnlocked ? (
          <>
            Import{" "}
            <a href={dfpunkPlayUrl} target="_blank" rel="noopener noreferrer">
              DF client
            </a>{" "}
            <span className="mono">dfpunk-account-*.json</span> into PXE. Bridge options stay
            hidden until that DF Punk PXE session is bound to this connector.
          </>
        ) : (
          <>
            Connect MetaMask (EIP-6963) or WalletConnect first. Aztec DF Punk PXE and bridge
            options stay hidden until the connector session validates.
          </>
        )}
      </p>

      <div className={`wallet-manager-grid${dfUnlocked ? "" : " wallet-manager-grid-solo"}`}>
        <div className="wallet-manager-col">
          <p className="label">ethereum · connector</p>
          {ethWallet ? (
            <>
              <p className="mono" title={ethWallet.address}>
                {shortHash(ethWallet.address)}
              </p>
              <p className="hint">
                {ethWallet.name ?? "Wallet"} · {ethWallet.rdns ?? "no-rdns"} · chain{" "}
                {ethWallet.chainId}
              </p>
              <p className={sessionOk ? "hint storage-status-ok" : "error"}>
                {sessionOk
                  ? "Connector session validated (privacy / anti-inject)."
                  : sessionReason ?? "Session not validated."}
              </p>
              <div className="wallet-manager-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || !sessionOk}
                  onClick={backupEthTxt}
                >
                  Backup address .txt
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={onConnectEth}>
                  Switch
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
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
              Connect MetaMask / WalletConnect
            </button>
          )}
        </div>

        {dfUnlocked ? (
          <div className="wallet-manager-col">
            <p className="label">aztec · df punk pxe</p>
            <div className="df-pxe-import">
              <p className="hint df-pxe-import-steps">
                In DF: Download account info → Import into PXE here → bridge only to that
                address.
              </p>
              <button
                type="button"
                className="df-pxe-import-btn"
                disabled={blocked}
                onClick={() => dfImportInputRef.current?.click()}
              >
                {importingPxe ? "Importing into PXE…" : "Import from DF client → PXE"}
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

            {bridgeReadyAccounts.length === 0 ? (
              <p className="hint">No DF Punk PXE session bound to this connector yet.</p>
            ) : !secretsVisible ? (
              <div className="row gap">
                <button type="button" className="primary" onClick={requestUnlock}>
                  Unlock vault to view PXE wallets
                </button>
                <p className="hint">Keys stay hidden until password + signingKey validate.</p>
              </div>
            ) : (
              <ul className="wallet-manager-list">
                {bridgeReadyAccounts.map((a) => {
                  const isActive = activeAztec?.toLowerCase() === a.address.toLowerCase();
                  return (
                    <li key={a.address} className={isActive ? "active" : undefined}>
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
                            setStatus(`Bridge recipient locked to DF PXE ${shortHash(a.address)}`);
                            await refresh();
                          })();
                        }}
                      >
                        <span className="mono">{shortHash(a.address)}</span>
                        <span className="hint">{a.label ?? "DF"} · PXE · bound</span>
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
        ) : null}
      </div>

      {status ? <p className="hint storage-status-ok">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
