import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectedWallet, L1BridgeBackend } from "@df-bridge/browser-sdk";
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
import { hasRpcOverrides, type RpcOverrides } from "../../lib/rpc-overrides.ts";
import { useVault } from "../../providers/VaultProvider.tsx";
import { isVaultUnlocked } from "../../lib/vault.ts";
import { importDfPunkFileIntoPxe, registerDfPunkAccountIntoPxe } from "../../lib/df-pxe-import.ts";

export function WalletManagerPanel(props: {
  networks: string[];
  networkId: string;
  setNetworkId: (id: string) => void;
  l1Backend: L1BridgeBackend;
  setL1Backend: (v: L1BridgeBackend) => void;
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
    networks,
    networkId,
    setNetworkId,
    l1Backend,
    setL1Backend,
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

  const [aztecAccounts, setAztecAccounts] = useState<ImportedAztecAccount[]>([]);
  const [activeAztec, setActiveAztec] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importingPxe, setImportingPxe] = useState(false);
  const [unlockingVault, setUnlockingVault] = useState(false);
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
      await refreshVaultAvailability();
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

  const unlockPxeFromIndexedDb = async () => {
    if (!sessionOk || !ethWallet) {
      setError("Validate MetaMask / WalletConnect first — vault unlock stays locked.");
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

    setUnlockingVault(true);
    setError(null);
    setStatus("Unlocking IndexedDB vault…");
    try {
      const restored = await unlockExistingVault();
      if (!restored) throw new Error("Vault unlock cancelled.");
      assertDfClientAccount(restored);
      let stored = { ...restored, fromDfClient: true as const };
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
            onProgress: (detail) => setStatus(detail),
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/derive/i.test(message)) throw err;
          setStatus(
            "Vault unlocked with the saved address. PXE re-registration derived a different address — use Quick Join for this session, or re-import the DF JSON if a claim fails.",
          );
        }
      }
      await saveAztecWallet(stored);
      await refresh();
      onApplyAztecAccount(stored);
      const readyMsg = `PXE restored from IndexedDB for ${shortHash(stored.address)} (bound to ${shortHash(ethWallet.address)}).`;
      setStatus(readyMsg);
      pushDappLog({
        kind: "announce",
        title: "Vault unlocked → PXE ready",
        detail: readyMsg,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logDappError(e, "Unlock PXE IndexedDB failed");
    } finally {
      setUnlockingVault(false);
    }
  };

  const blocked = busy || importingPxe || unlockingVault;
  const dfUnlocked = sessionOk && !!ethWallet && browserClaimEnabled;

  const bridgeReadyAccounts = aztecAccounts.filter((a) =>
    isBridgeReadyDfPxeAccount(a, ethWallet?.address),
  );

  return (
    <section className="card wallet-manager" aria-label="Wallet manager">
      <strong>Wallet manager</strong>
      <p className="hint">
        {dfUnlocked ? (
          vaultAvailable ? (
            <>
              Password-locked IndexedDB vault found. Unlock with password + passkey to restore
              the DF Punk PXE session — no JSON re-import needed.
            </>
          ) : (
            <>
              Import{" "}
              <a href={dfpunkPlayUrl} target="_blank" rel="noopener noreferrer">
                DF client
              </a>{" "}
              <span className="mono">dfpunk-account-*.json</span> into PXE. Bridge options stay
              hidden until that DF Punk PXE session is bound to this connector.
            </>
          )
        ) : (
          <>
            Connect MetaMask (EIP-6963) or WalletConnect first. Aztec DF Punk PXE and bridge
            options stay hidden until the connector session validates.
          </>
        )}
      </p>

      <div className="wallet-manager-network">
        <p className="label">network setup</p>
        <div className="network-row">
          <label>
            Network
            <select
              value={networkId}
              disabled
              title="Locked to mainnet for now"
              onChange={(e) => setNetworkId(e.target.value)}
            >
              {networks.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            L1 backend
            <select
              value={l1Backend}
              disabled
              title="Locked to portal for now"
              onChange={(e) => setL1Backend(e.target.value as L1BridgeBackend)}
            >
              <option value="portal">portal</option>
              <option value="gobridge">gobridge</option>
            </select>
          </label>
        </div>
        <p className="hint">
          Network locked to <span className="mono">mainnet</span>; L1 backend locked to{" "}
          <span className="mono">portal</span>. Addresses are baked into the frontend config.
          {hasRpcOverrides(rpcOverrides)
            ? " Custom RPC overrides active (gear) — verify hosts before signing; custom RPCs can see request metadata."
            : null}
        </p>
      </div>

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
              {vaultAvailable ? (
                <>
                  <p className="hint df-pxe-import-steps">
                    IndexedDB vault already has your DF Punk wallet (password-protected). Unlock
                    after refresh to continue.
                  </p>
                  <button
                    type="button"
                    className={`df-pxe-import-btn${ethWallet && sessionOk && !blocked ? " cta-pulse" : ""}`}
                    disabled={blocked}
                    onClick={() => void unlockPxeFromIndexedDb()}
                  >
                    {unlockingVault ? "Reading PXE IndexedDB…" : "Unlock / read PXE IndexedDB"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={blocked}
                    onClick={() => dfImportInputRef.current?.click()}
                  >
                    Or import DF Punk JSON…
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
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
              <p className="hint">
                {vaultAvailable
                  ? "Unlock the vault to restore the PXE session for this connector."
                  : "No DF Punk PXE session bound to this connector yet."}
              </p>
            ) : !secretsVisible ? (
              <div className="row gap">
                <button type="button" className="primary" onClick={requestUnlock}>
                  Unlock vault to view PXE wallets
                </button>
                <p className="hint">Keys stay hidden until password + passkey unlock.</p>
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
