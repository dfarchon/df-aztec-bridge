import { useCallback, useContext, useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import { accountFromNulo, assertDfClientAccount, readAccountFile } from "../../lib/account-import.ts";
import {
  isBridgeReadyDfPxeAccount,
  isInspectableDfAccount,
} from "../../lib/df-pxe-bridge-guard.ts";
import {
  assertAztecReplaceBackupReady,
  getActiveAztecWallet,
  listStoredAztecWallets,
  saveAztecWallet,
} from "../../lib/aztec-wallet-store.ts";
import {
  aztecBackupJsonFilename,
  downloadJsonBackup,
  serializeAztecWalletJson,
} from "../../lib/wallet-backup.ts";
import { shortHash } from "../../lib/claim-recovery.ts";
import { DFPUNK_PLAY_URL_DEFAULT } from "../../lib/df-client-links.ts";
import { getNetwork, l1ChainLabel } from "../../config/networks.ts";
import {
  isTrustedConnector,
  tryValidateConnectedWalletSession,
} from "../../lib/wallet-session-guard.ts";
import { logDappError, pushDappLog } from "../../lib/dapp-log.ts";
import { recordHistory } from "../../lib/operation-history.ts";
import { hasRpcOverrides, type RpcOverrides } from "../../lib/rpc-overrides.ts";
import { useVault } from "../../providers/VaultProvider.tsx";
import {
  deleteVaultProfile,
  isVaultUnlocked,
  listVaultProfiles,
  wipeUnlockedVaultProfile,
} from "../../lib/vault.ts";
import {
  createV6PxeAccount,
  importDfPunkFileIntoPxe,
  registerDfPunkAccountIntoPxe,
  verifyPreV6AccountOnV6,
} from "../../lib/df-pxe-import.ts";
import { ConnectNoticeHostContext } from "../../components/ui/ConnectSessionGate.tsx";
import { useUi } from "../../providers/UiProvider.tsx";

function DfAccountDropZone({ disabled, importing, onChoose, onFiles }: {
  disabled: boolean;
  importing: boolean;
  onChoose: () => void;
  onFiles: (files: FileList) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  return (
    <div
      className={`df-account-drop-wrap${dragging && !disabled ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!disabled && event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
      }}
    >
      <button type="button" className="df-account-drop" disabled={disabled} onClick={onChoose}>
        <span className="df-account-drop-icon" aria-hidden="true">↑</span>
        <span className="df-account-drop-copy">
          <strong>{importing ? "Importing…" : dragging ? "Drop your DF account file" : "Import DF account"}</strong>
          <span>Drag and drop a JSON file here, or click to choose</span>
        </span>
      </button>
    </div>
  );
}

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
  initialAztecAccounts?: ImportedAztecAccount[];
  initialActiveAztec?: string | null;
  ethSessionOk?: boolean;
  vaultTimeoutNotice?: string | null;
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
    initialAztecAccounts,
    initialActiveAztec,
    ethSessionOk = false,
    vaultTimeoutNotice = null,
  } = props;

  const {
    requireVaultAfterPxeImport,
    ensureUnlocked,
    unlockExistingVault,
    vaultAvailable,
    refreshVaultAvailability,
    secretsVisible,
    unlocked,
  } = useVault();

  const [aztecAccounts, setAztecAccounts] = useState<ImportedAztecAccount[]>(
    () => initialAztecAccounts ?? [],
  );
  const [activeAztec, setActiveAztec] = useState<string | null>(
    () => initialActiveAztec ?? null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importingPxe, setImportingPxe] = useState(false);
  const [creatingPxe, setCreatingPxe] = useState(false);
  const [nuloAccount, setNuloAccount] = useState<ImportedAztecAccount | null>(null);
  const appliedNulo = useRef<string | null>(null);
  const [unlockingVault, setUnlockingVault] = useState(false);
  const [gateHandoff, setGateHandoff] = useState(false);
  const noticeHost = useContext(ConnectNoticeHostContext);
  const { shellReady } = useUi();
  const onConnectGate = noticeHost !== undefined;
  const [sessionSnapshot, setSessionSnapshot] = useState<{
    address: string | null;
    ok: boolean;
    reason: string | null;
  }>(() => {
    const address = ethWallet?.address.toLowerCase() ?? null;
    if (address && ethSessionOk) {
      return { address, ok: true, reason: null };
    }
    return { address: null, ok: false, reason: null };
  });
  const [addressCopied, setAddressCopied] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [rebaseSource, setRebaseSource] = useState<ImportedAztecAccount | null>(null);
  const [rebaseVerified, setRebaseVerified] = useState<ImportedAztecAccount | null>(null);
  const [rebaseDownloaded, setRebaseDownloaded] = useState(false);
  const [rebaseChecking, setRebaseChecking] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceBackedUp, setReplaceBackedUp] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const dfImportInputRef = useRef<HTMLInputElement>(null);
  const replaceBackedUpRef = useRef(false);
  const copyResetTimerRef = useRef<number | null>(null);
  /** Bumped on disconnect so in-flight PXE progress cannot repaint notices. */
  const noticeEpoch = useRef(0);

  const dropSessionNotices = useCallback(() => {
    noticeEpoch.current += 1;
    setStatus(null);
    setError(null);
    setFormatOpen(false);
    setReplaceOpen(false);
    setReplaceBackedUp(false);
    replaceBackedUpRef.current = false;
    setRemoveConfirm(false);
    setImportingPxe(false);
    setUnlockingVault(false);
    setGateHandoff(false);
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

  const walletAddress = ethWallet?.address.toLowerCase() ?? null;
  const sessionChecking =
    !!walletAddress && sessionSnapshot.address !== walletAddress;
  const sessionOk =
    !!walletAddress && sessionSnapshot.address === walletAddress && sessionSnapshot.ok;
  const sessionReason = sessionChecking
    ? null
    : sessionSnapshot.address === walletAddress
      ? sessionSnapshot.reason
      : ethWallet
        ? null
        : "Connect a wallet to continue.";

  /** Continuously validate connector; DF PXE actions stay locked until this passes. */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (busy) return;
      if (!ethWallet) {
        if (!cancelled) {
          setSessionSnapshot({
            address: null,
            ok: false,
            reason: "Connect a wallet to continue.",
          });
          onEthSessionValidated?.(false);
        }
        return;
      }
      const address = ethWallet.address.toLowerCase();
      if (!isTrustedConnector(ethWallet)) {
        if (!cancelled) {
          setSessionSnapshot({
            address,
            ok: false,
            reason: "This wallet can't be used. Connect MetaMask or WalletConnect.",
          });
          onEthSessionValidated?.(false);
        }
        return;
      }
      const result = await tryValidateConnectedWalletSession(ethWallet);
      if (cancelled) return;
      if (result.ok) {
        setSessionSnapshot({ address, ok: true, reason: null });
        onEthSessionValidated?.(true);
      } else {
        setSessionSnapshot({
          address,
          ok: false,
          reason: result.reason,
        });
        onEthSessionValidated?.(false);
      }
    };
    void run();
    const id = window.setInterval(() => void run(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ethWallet, onEthSessionValidated, busy]);

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
    if (!formatOpen && !replaceOpen && !removeConfirm && !rebaseOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFormatOpen(false);
      setReplaceOpen(false);
      setRemoveConfirm(false);
      setRebaseOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [formatOpen, replaceOpen, removeConfirm, rebaseOpen]);

  const backupAztecJson = (account: ImportedAztecAccount) => {
    const filename = aztecBackupJsonFilename(account.address);
    downloadJsonBackup(filename, serializeAztecWalletJson(account));
    replaceBackedUpRef.current = true;
    setReplaceBackedUp(true);
    setStatus(`Backup downloaded — keep ${filename} secret.`);
  };

  const resolveExistingAztecAddress = async (): Promise<string | null> => {
    if (aztecAccounts[0]?.address) return aztecAccounts[0].address;
    const active = await getActiveAztecWallet();
    if (active) return active;
    const profiles = await listVaultProfiles();
    return profiles[0]?.aztecAddress ?? null;
  };

  const storePxeAccount = async (
    stored: ImportedAztecAccount,
    existingAddress: string | null,
    live: () => boolean,
    historyKind: "account-imported" | "account-created",
    opts?: { discardLockedVault?: boolean },
  ) => {
    assertAztecReplaceBackupReady({
      existingAddress,
      incomingAddress: stored.address,
      backupReady: replaceBackedUpRef.current,
      discardLockedVault: opts?.discardLockedVault,
    });
    await requireVaultAfterPxeImport(stored);
    if (!live()) return;
    const ok = await ensureUnlocked("secrets", stored);
    if (!live()) return;
    if (!ok) throw new Error("Vault password required after the Aztec account is ready.");
    await saveAztecWallet(stored);
    if (!live()) return;
    const profiles = await listVaultProfiles();
    for (const profile of profiles) {
      if (profile.aztecAddress.toLowerCase() !== stored.address.toLowerCase()) {
        await deleteVaultProfile(profile.aztecAddress);
      }
    }
    if (!live()) return;
    await refreshVaultAvailability();
    await refresh();
    if (!live()) return;
    replaceBackedUpRef.current = false;
    setReplaceBackedUp(false);
    setReplaceOpen(false);
    onApplyAztecAccount(stored);
    const replaced =
      !!existingAddress &&
      existingAddress.toLowerCase() !== stored.address.toLowerCase();
    void recordHistory({
      networkId,
      kind: replaced ? "account-replaced" : historyKind,
      recipient: stored.address,
    });
    const readyMsg = `DF Aztec PXE ready for ${shortHash(stored.address)} (bound to ${shortHash(stored.boundEthAddress ?? ethWallet?.address ?? "")}). Bridge unlocked.`;
    setStatus(readyMsg);
    pushDappLog({
      kind: "announce",
      title: historyKind === "account-created" ? "DF Aztec account ready" : "DF Aztec account imported",
      detail: readyMsg,
    });
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

    const existingAddress = await resolveExistingAztecAddress();
    // Locked leftover vault (e.g. 5.1) — allow replace without a JSON backup download.
    const discardLockedVault = vaultAvailable && !secretsVisible;
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
      await storePxeAccount(stored, existingAddress, live, "account-imported", {
        discardLockedVault,
      });
    } catch (e: unknown) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      if (/do not recreate address/i.test(message)) {
        try {
          const [primary] = await readAccountFile(file);
          if (primary?.signingKey?.trim()) {
            setFormatOpen(false);
            setReplaceOpen(false);
            setRemoveConfirm(false);
            setRebaseSource(primary);
            setRebaseVerified(null);
            setRebaseDownloaded(false);
            setRebaseOpen(true);
            setError(null);
            setStatus(
              "This file's address is v5 / v5.1. Verify an Aztec 6.0 address from the same keys before saving a new backup.",
            );
            return;
          }
        } catch {
          /* fall through to the raw error */
        }
      }
      setError(message);
      logDappError(e, "Import DF Punk → PXE failed");
    } finally {
      if (live()) setImportingPxe(false);
    }
  };

  const importDroppedFiles = (files: FileList) => {
    if (files.length !== 1) {
      setError("Choose one DF account JSON file.");
      return;
    }
    void importFromDfClientIntoPxe(files[0]);
  };

  const createV6Wallet = async () => {
    if (!sessionOk || !ethWallet) {
      setError("Connect a wallet first.");
      return;
    }
    if (!browserClaimEnabled) {
      setError("Account creation isn't available in this browser.");
      return;
    }
    if (!aztecNodeUrl) {
      setError("Select a network first.");
      return;
    }

    const existingAddress = await resolveExistingAztecAddress();
    const discardLockedVault = vaultAvailable && !secretsVisible;
    const epoch = noticeEpoch.current;
    const live = () => noticeEpoch.current === epoch;
    setCreatingPxe(true);
    setError(null);
    setStatus("Creating a DF Aztec account (Schnorr initializerless) in this browser…");
    let downloaded = false;
    try {
      const stored = await createV6PxeAccount({
        ethWallet,
        networkId,
        aztecNodeUrl,
        onProgress: (detail) => {
          if (live()) setStatus(detail);
        },
      });
      if (!live()) return;
      backupAztecJson(stored);
      downloaded = true;
      if (!live()) return;
      setStatus("DF account backup downloaded. Set a vault password to keep it in this browser.");
      await storePxeAccount(stored, existingAddress, live, "account-created", {
        discardLockedVault,
      });
    } catch (e: unknown) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(
        downloaded
          ? `Wallet file downloaded. Saving it in this browser failed: ${message}`
          : message,
      );
      logDappError(e, "Create DF Aztec account failed");
    } finally {
      if (live()) setCreatingPxe(false);
    }
  };

  const openV6Rebase = (account: ImportedAztecAccount) => {
    setFormatOpen(false);
    setReplaceOpen(false);
    setRemoveConfirm(false);
    setRebaseSource(account);
    setRebaseVerified(null);
    setRebaseDownloaded(false);
    setRebaseOpen(true);
    setError(null);
  };

  const verifyV6Rebase = async () => {
    if (!rebaseSource || !sessionOk || !ethWallet) {
      setError("Connect a wallet first.");
      return;
    }
    if (!aztecNodeUrl) {
      setError("Select a network first.");
      return;
    }
    const epoch = noticeEpoch.current;
    const live = () => noticeEpoch.current === epoch;
    setRebaseChecking(true);
    setError(null);
    setStatus("Checking these Schnorr keys on Aztec 6.0…");
    try {
      const verified = await verifyPreV6AccountOnV6({
        account: rebaseSource,
        ethWallet,
        networkId,
        aztecNodeUrl,
        onProgress: (detail) => {
          if (live()) setStatus(detail);
        },
      });
      if (!live()) return;
      setRebaseVerified(verified);
      setRebaseDownloaded(false);
      setStatus(
        `Aztec 6.0 address verified: ${shortHash(verified.address)}. Download the backup, then use that address.`,
      );
    } catch (e: unknown) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      setRebaseVerified(null);
      setError(message);
      logDappError(e, "Verify Aztec 6.0 address failed");
    } finally {
      if (live()) setRebaseChecking(false);
    }
  };

  const downloadVerifiedV6Backup = () => {
    if (!rebaseVerified || !rebaseSource) return;
    if (
      rebaseVerified.secretKey !== rebaseSource.secretKey ||
      rebaseVerified.salt !== rebaseSource.salt ||
      rebaseVerified.signingKey !== rebaseSource.signingKey
    ) {
      setError("Refusing to download a backup that changed the keys.");
      return;
    }
    const filename = aztecBackupJsonFilename(rebaseVerified.address);
    downloadJsonBackup(filename, serializeAztecWalletJson(rebaseVerified));
    setRebaseDownloaded(true);
    const existing = aztecAccounts[0]?.address;
    const sameVault =
      !existing || existing.toLowerCase() === rebaseSource.address.toLowerCase();
    if (sameVault) {
      replaceBackedUpRef.current = true;
      setReplaceBackedUp(true);
    }
    setStatus(`Verified backup downloaded — keep ${filename} secret.`);
  };

  const adoptVerifiedV6Account = async () => {
    if (!rebaseVerified || !rebaseDownloaded) {
      setError("Download the verified Aztec 6.0 backup first.");
      return;
    }
    const existingAddress = await resolveExistingAztecAddress();
    const discardLockedVault = vaultAvailable && !secretsVisible;
    const epoch = noticeEpoch.current;
    const live = () => noticeEpoch.current === epoch;
    setRebaseChecking(true);
    setError(null);
    try {
      await storePxeAccount(rebaseVerified, existingAddress, live, "account-imported", {
        discardLockedVault,
      });
      if (!live()) return;
      setRebaseOpen(false);
      setRebaseSource(null);
      setRebaseVerified(null);
    } catch (e: unknown) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logDappError(e, "Save verified Aztec 6.0 account failed");
    } finally {
      if (live()) setRebaseChecking(false);
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
    setStatus(null);
    try {
      const restored = await unlockExistingVault();
      if (!live()) return;
      if (!restored) return;

      // Older Nulo vaults store the address only. New connects are DF Aztec 6.0.
      const looksLikeNulo =
        restored.connector === "nulo" ||
        (!restored.signingKey?.trim() && !restored.secretKey?.trim());
      if (looksLikeNulo) {
        const stored = accountFromNulo(restored.address, ethWallet.address);
        appliedNulo.current = stored.address.toLowerCase();
        setNuloAccount(stored);
        await saveAztecWallet(stored);
        if (!live()) return;
        await refresh();
        if (!live()) return;
        onApplyAztecAccount(stored);
        if (onConnectGate) setGateHandoff(true);
        setStatus(
          `Nulo address restored (${shortHash(stored.address)}). This bridge now uses Dark Forest Aztec 6.0 accounts. Disconnect this address to import or create one.`,
        );
        pushDappLog({
          kind: "announce",
          title: "Nulo vault unlocked",
          detail:
            "Recipient address restored from the vault. New L2 accounts are Dark Forest Aztec 6.0. Disconnect this address to import or create one.",
          ttlMs: 16_000,
        });
        return;
      }

      assertDfClientAccount(restored);
      let stored: ImportedAztecAccount = {
        ...restored,
        fromDfClient: true,
        boundEthAddress: ethWallet.address.toLowerCase(),
      };
      if (!restored.pxeRegistered || restored.walletCompat === "pre-v6") {
        try {
          if (restored.walletCompat !== "pre-v6") {
            stored = await registerDfPunkAccountIntoPxe({
              account: stored,
              ethWallet,
              networkId,
              aztecNodeUrl,
            });
          } else {
            stored = { ...stored, pxeRegistered: false, walletCompat: "pre-v6" };
          }
        } catch (err: unknown) {
          if (!live()) return;
          const message = err instanceof Error ? err.message : String(err);
          if (!/derive|do not recreate address|5\.1/i.test(message)) throw err;
          stored = {
            ...stored,
            pxeRegistered: false,
            walletCompat: "pre-v6",
            boundEthAddress: ethWallet.address.toLowerCase(),
          };
          pushDappLog({
            kind: "error",
            title: "Pre-6.0 Aztec account (v5 / v5.1)",
            detail:
              "Bridge page will open with a warning. Do not bridge to this address. Open Wallets and verify an Aztec 6.0 address from the same keys.",
            ttlMs: 20_000,
          });
        }
      } else if (!stored.walletCompat && stored.secretKey && stored.signingKey) {
        try {
          const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
          const { classifyAztecWalletCompat, warmupBrowserClaim } = await loadBrowserClaim();
          await warmupBrowserClaim({
            networkId,
            aztecNodeUrl,
          });
          const compat = await classifyAztecWalletCompat({
            networkId,
            aztecNodeUrl,
            address: stored.address,
            secretKey: stored.secretKey,
            salt: stored.salt,
            signingKey: stored.signingKey,
          });
          stored = {
            ...stored,
            walletCompat: compat,
            pxeRegistered: compat !== "pre-v6" && stored.pxeRegistered,
            boundEthAddress: ethWallet.address.toLowerCase(),
          };
        } catch {
          /* classification is best-effort; bridge UI can still warn as unknown */
        }
      }
      if (!live()) return;
      await saveAztecWallet(stored);
      if (!live()) return;
      await refresh();
      if (!live()) return;
      onApplyAztecAccount(stored);
      if (onConnectGate) setGateHandoff(true);
      const preV6 = stored.walletCompat === "pre-v6";
      pushDappLog({
        kind: preV6 ? "error" : "announce",
        title: preV6 ? "Vault unlocked — v5 / v5.1 wallet" : "Vault unlocked → PXE ready",
        detail: preV6
          ? `${shortHash(stored.address)} is not Aztec 6.0. Bridge UI is open with a warning; bridging stays locked.`
          : `PXE restored from IndexedDB for ${shortHash(stored.address)} (bound to ${shortHash(ethWallet.address)}).`,
        ttlMs: preV6 ? 18_000 : 12_000,
      });
    } catch (e: unknown) {
      if (!live()) return;
      setGateHandoff(false);
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logDappError(e, "Unlock PXE IndexedDB failed");
    } finally {
      if (live()) setUnlockingVault(false);
    }
  };

  const cancelNulo = async () => {
    setStatus(null);
    const { disconnectNulo } = await import("@df-bridge/browser-sdk/nulo");
    await disconnectNulo();
    appliedNulo.current = null;
    setNuloAccount(null);
    onClearAztecAccount?.();
  };

  useEffect(() => {
    const eth = ethWallet?.address;
    if (!eth) return;
    let cancelled = false;
    void import("@df-bridge/browser-sdk/nulo").then(({ getNuloAddress }) => {
      if (cancelled) return;
      const address = getNuloAddress();
      if (!address) return;
      const stored = accountFromNulo(address, eth);
      setNuloAccount(stored);
      if (appliedNulo.current === stored.address.toLowerCase()) return;
      appliedNulo.current = stored.address.toLowerCase();
      onApplyAztecAccount(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [ethWallet?.address, onApplyAztecAccount]);

  const pendingGateHandoff =
    onConnectGate && (unlockingVault || (gateHandoff && !shellReady));
  const blocked =
    busy || importingPxe || creatingPxe || unlockingVault || pendingGateHandoff || rebaseChecking;
  const showAztecPane = !!ethWallet && browserClaimEnabled;
  const hideGateEthereum = onConnectGate && !!ethWallet && showAztecPane;
  const l2ActionsDisabled = blocked || !sessionOk || sessionChecking;

  const bridgeReadyAccounts = aztecAccounts.filter((a) =>
    isBridgeReadyDfPxeAccount(a, ethWallet?.address),
  );
  const inspectableAccounts = aztecAccounts.filter((a) =>
    isInspectableDfAccount(a, ethWallet?.address),
  );
  const currentAccount = onConnectGate
    ? null
    : secretsVisible
      ? (bridgeReadyAccounts[0] ?? inspectableAccounts[0] ?? null)
      : null;
  const showUnlock = vaultAvailable && !currentAccount && !nuloAccount;
  const displayedAccount = nuloAccount ?? currentAccount;

  const startReplace = () => {
    if (!currentAccount) return;
    setFormatOpen(false);
    setRemoveConfirm(false);
    setReplaceBackedUp(false);
    replaceBackedUpRef.current = false;
    setReplaceOpen(true);
  };

  const removeCurrentAccount = async () => {
    if (!currentAccount) return;
    const ok = await ensureUnlocked("secrets");
    if (!ok) return;
    const removedAddress = currentAccount.address;
    void recordHistory({
      networkId,
      kind: "account-removed",
      recipient: removedAddress,
    });
    await wipeUnlockedVaultProfile();
    onClearAztecAccount?.();
    await refreshVaultAvailability();
    await refresh();
    setRemoveConfirm(false);
    setReplaceOpen(false);
    setStatus("Removed the Aztec account and password vault from this browser.");
  };
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
          <div
            className="wallet-manager-notice is-error"
            role="alert"
            onClick={(event) => {
              if ((event.target as Element).closest("button, a")) return;
              setError(null);
            }}
          >
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

      {hideGateEthereum && expectedL1ChainId != null && ethWallet.chainId !== expectedL1ChainId ? (
        <p className="error">Switch your wallet to {expectedL1Name ?? "the correct network"}.</p>
      ) : null}
      {hideGateEthereum && !sessionChecking && !sessionOk && sessionReason ? (
        <p className="error">{sessionReason}</p>
      ) : null}

      <div
        className={`wallet-manager-grid${!showAztecPane || hideGateEthereum ? " wallet-manager-grid-solo" : ""}`}
      >
        {!hideGateEthereum ? (
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
              {sessionChecking || sessionOk ? null : (
                <p className="error">
                  {sessionReason ?? "Reconnect wallet to continue."}
                </p>
              )}
              {!onConnectGate ? <div className="wallet-manager-actions">
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
              </div> : null}
            </>
          ) : (
            <button type="button" data-boot-connect-wallet disabled={blocked} onClick={onConnectEth}>
              Connect wallet
            </button>
          )}
        </div>
        ) : null}

        {showAztecPane ? (
          <div className="wallet-manager-col" data-boot-wallet-step>
            {formatOpen ? (
              <div className="df-pxe-format-pane">
                <p className="wallet-manager-pane-title">What file is this?</p>
                <p className="hint df-pxe-import-steps">
                  A JSON file named <span className="mono">dfpunk-account-*.json</span> from a Dark
                  Forest Aztec (Schnorr initializerless) wallet. A file saved on Aztec v5 or v5.1
                  keeps the same keys, but its address is not the Aztec 6.0 address. Use Verify
                  Aztec 6.0 address to check those keys and download a backup with only the address
                  updated.
                </p>
                <p className="hint df-pxe-import-steps">
                  Get it from Dark Forest Aztec → Settings → Download account info, or from Create DF
                  account in this app. It looks like:
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
            {replaceOpen && currentAccount ? (
              <div className="df-pxe-format-pane">
                <p className="wallet-manager-pane-title">Replace DF Aztec account</p>
                <ol className="wallet-replace-steps">
                  <li>
                    This browser keeps one DF Aztec account. Current account:{" "}
                    <span className="mono">{shortHash(currentAccount.address)}</span>.
                  </li>
                  <li>
                    Download a JSON backup first. The file uses the same{" "}
                    <span className="mono">dfpunk-account-*.json</span> fields as Dark Forest
                    (Schnorr initializerless).
                  </li>
                  <li>
                    After the backup downloads, create a new DF account or import a dfpunk account
                    JSON.
                  </li>
                  <li>
                    Importing another address replaces this account and deletes its password vault
                    from this browser.
                  </li>
                </ol>
                <button
                  type="button"
                  className="df-pxe-import-btn"
                  disabled={l2ActionsDisabled}
                  onClick={() => backupAztecJson(currentAccount)}
                >
                  Download JSON backup
                </button>
                {replaceBackedUp ? (
                  <p className="hint">Backup saved. You can import the next account.</p>
                ) : (
                  <p className="hint">The next import stays locked until this backup downloads.</p>
                )}
                <button
                  type="button"
                  className="df-pxe-import-btn"
                  disabled={l2ActionsDisabled || !replaceBackedUp}
                  onClick={() => void createV6Wallet()}
                >
                  {creatingPxe ? "Creating…" : "Create DF account"}
                </button>
                <DfAccountDropZone
                  disabled={l2ActionsDisabled || !replaceBackedUp}
                  importing={importingPxe}
                  onChoose={() => dfImportInputRef.current?.click()}
                  onFiles={importDroppedFiles}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setReplaceOpen(false)}
                >
                  Back
                </button>
              </div>
            ) : null}
            {removeConfirm && currentAccount ? (
              <div className="df-pxe-format-pane">
                <p className="wallet-manager-pane-title">Remove Aztec account</p>
                <p className="hint">
                  This removes the Aztec account and its password vault from this browser. The Dark
                  Forest game account is not deleted.
                </p>
                <button
                  type="button"
                  className="ghost"
                  disabled={l2ActionsDisabled}
                  onClick={() => backupAztecJson(currentAccount)}
                >
                  Download JSON backup
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={l2ActionsDisabled}
                  onClick={() => void removeCurrentAccount()}
                >
                  Confirm remove
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRemoveConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {rebaseOpen && rebaseSource ? (
              <div className="df-pxe-format-pane">
                <p className="wallet-manager-pane-title">Aztec 6.0 address from this backup</p>
                <p className="hint df-pxe-import-steps">
                  The file address is a v5 / v5.1 Schnorr account.{" "}
                  <span className="mono">secretKey</span>, <span className="mono">salt</span>, and{" "}
                  <span className="mono">signingKey</span> stay the same. This check derives the
                  Schnorr initializerless address on Aztec 6.0 and writes a new backup only when
                  that address matches the keys.
                </p>
                <dl className="wallet-manager-account-meta">
                  <div>
                    <dt>File address</dt>
                    <dd className="mono">{shortHash(rebaseSource.address)}</dd>
                  </div>
                  {rebaseVerified ? (
                    <div>
                      <dt>Aztec 6.0 address</dt>
                      <dd className="mono">{shortHash(rebaseVerified.address)}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="hint">
                  Do not bridge to the file address. Fee Juice already sent there stays there.
                  Bridge only to the verified 6.0 address.
                </p>
                {rebaseVerified ? (
                  <>
                    <button
                      type="button"
                      className="df-pxe-import-btn"
                      disabled={l2ActionsDisabled}
                      onClick={downloadVerifiedV6Backup}
                    >
                      Download verified backup
                    </button>
                    <button
                      type="button"
                      className="df-pxe-import-btn"
                      disabled={l2ActionsDisabled || !rebaseDownloaded}
                      onClick={() => void adoptVerifiedV6Account()}
                    >
                      {rebaseChecking ? "Saving…" : "Use this 6.0 account"}
                    </button>
                    {!rebaseDownloaded ? (
                      <p className="hint">Download the backup before this browser keeps the account.</p>
                    ) : (
                      <p className="hint">
                        The JSON file changed the address only. Keep it secret, the same way as a DF
                        account download.
                      </p>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="df-pxe-import-btn"
                    disabled={l2ActionsDisabled}
                    onClick={() => void verifyV6Rebase()}
                  >
                    {rebaseChecking ? "Checking…" : "Verify Aztec 6.0 address"}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRebaseOpen(false)}
                >
                  Back
                </button>
              </div>
            ) : null}
            <div
              className={`wallet-manager-col-body${
                formatOpen || replaceOpen || removeConfirm || rebaseOpen ? " is-hidden" : ""
              }`}
              aria-hidden={formatOpen || replaceOpen || removeConfirm || rebaseOpen}
            >
            <p className="wallet-manager-pane-title">Aztec L2</p>
            {displayedAccount ? (
              <>
                <ul className="wallet-manager-list">
                  <li
                    className={
                      activeAztec?.toLowerCase() === displayedAccount.address.toLowerCase()
                        ? "active"
                        : undefined
                    }
                  >
                    <div className="wallet-manager-pick">
                      <span className="wallet-manager-account-kicker">
                        {displayedAccount.connector === "nulo"
                          ? "Nulo wallet (optional)"
                          : "DF Aztec account"}
                      </span>
                      {displayedAccount.connector === "nulo" ? (
                        <p className="hint">
                          Connected as a secondary signer. Nulo keeps the keys; this browser only
                          uses the address. DF Punk account JSON remains the primary path.
                        </p>
                      ) : (
                        <p className="hint">
                          Schnorr initializerless — same format as Dark Forest Aztec Download account
                          info.
                        </p>
                      )}
                      <dl className="wallet-manager-account-meta">
                        <div>
                          <dt>Aztec address</dt>
                          <dd className="mono">{shortHash(displayedAccount.address)}</dd>
                        </div>
                        <div>
                          <dt>Bridge</dt>
                          <dd>
                            {displayedAccount.connector === "nulo"
                              ? "Connected"
                              : displayedAccount.walletCompat === "pre-v6"
                                ? "Blocked"
                                : "Ready"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="wallet-manager-account-actions">
                      {displayedAccount.connector === "nulo" ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={l2ActionsDisabled}
                          onClick={() => void cancelNulo()}
                        >
                          Disconnect Nulo
                        </button>
                      ) : (
                        <>
                          {displayedAccount.walletCompat === "pre-v6" ? (
                            <button
                              type="button"
                              className="df-pxe-import-btn"
                              disabled={l2ActionsDisabled}
                              onClick={() => openV6Rebase(displayedAccount)}
                            >
                              Verify Aztec 6.0 address
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ghost"
                            disabled={l2ActionsDisabled}
                            onClick={startReplace}
                          >
                            Replace account
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            disabled={l2ActionsDisabled}
                            onClick={() => {
                              setFormatOpen(false);
                              setReplaceOpen(false);
                              setRemoveConfirm(true);
                            }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                </ul>
              </>
            ) : (
              <div className="df-pxe-import">
                <p className="hint df-pxe-import-steps">
                  Primary path: import a Dark Forest Aztec{" "}
                  <span className="mono">dfpunk-account-*.json</span> backup (Schnorr
                  initializerless), or create a matching DF account here. This browser keeps one
                  saved account.
                </p>
                <p className="hint df-pxe-import-steps">
                  Get a backup from{" "}
                  <a
                    href={dfpunkPlayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Dark Forest Aztec
                  </a>{" "}
                  → Settings → Download account info. A v5 / v5.1 file opens the Aztec 6.0 address
                  check instead of importing the old address.
                </p>
                {sessionOk || sessionChecking ? (
                  showUnlock ? (
                    <p className="hint">
                      {vaultTimeoutNotice ??
                        "A DF account vault is saved in this browser. Unlock it, or import / create an Aztec 6.0 DF account. A v5 / v5.1 backup can be checked for a new 6.0 address."}
                    </p>
                  ) : (
                    <p className="hint">Ready to import or create a DF Aztec account.</p>
                  )
                ) : sessionReason && !hideGateEthereum ? (
                  <p className="error">{sessionReason}</p>
                ) : null}
                {showUnlock ? (
                  <button
                    type="button"
                    className="df-pxe-import-btn"
                    disabled={l2ActionsDisabled}
                    onClick={() => void unlockPxeFromIndexedDb()}
                  >
                    {unlockingVault || pendingGateHandoff ? "Unlocking…" : "Unlock saved DF account"}
                  </button>
                ) : null}
                <DfAccountDropZone
                  disabled={l2ActionsDisabled}
                  importing={importingPxe}
                  onChoose={() => dfImportInputRef.current?.click()}
                  onFiles={importDroppedFiles}
                />
                <button
                  type="button"
                  className={`df-pxe-import-btn${ethWallet && sessionOk && !l2ActionsDisabled && !showUnlock ? " cta-pulse" : ""}`}
                  disabled={l2ActionsDisabled}
                  onClick={() => void createV6Wallet()}
                >
                  {creatingPxe ? "Creating…" : "Create DF account"}
                </button>
                <button
                  type="button"
                  className="df-pxe-import-format-toggle"
                  aria-expanded={formatOpen}
                  onClick={() => {
                    setReplaceOpen(false);
                    setRemoveConfirm(false);
                    setFormatOpen(true);
                  }}
                >
                  What file is this?
                </button>
              </div>
            )}
            </div>
            <input
              ref={dfImportInputRef}
              type="file"
              className="sr-only"
              accept=".json,application/json"
              disabled={l2ActionsDisabled || (replaceOpen && !replaceBackedUp)}
              aria-label="Import dfpunk-account JSON from DF client into PXE"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                void importFromDfClientIntoPxe(f);
                e.target.value = "";
              }}
            />
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
