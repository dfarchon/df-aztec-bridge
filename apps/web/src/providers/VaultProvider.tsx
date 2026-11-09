import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ImportedAztecAccount } from "../lib/account-import.ts";
import {
  bindVaultAddress,
  getVaultProfile,
  getVaultSession,
  hasAnyVaultProfile,
  hasVaultProfile,
  isVaultUnlocked,
  listVaultProfiles,
  lockVault,
  setupVault,
  subscribeVault,
  unlockVault,
  wipeVaultProfileWithPassword,
  attachVaultPasskey,
  VaultError,
} from "../lib/vault.ts";
import {
  getStoredAztecWallet,
  listStoredAztecWallets,
} from "../lib/aztec-wallet-store.ts";
import {
  VaultUnlockModal,
  type VaultModalMode,
} from "../components/vault/VaultUnlockModal.tsx";
import { useUi } from "./UiProvider.tsx";
import { pushDappLog } from "../lib/dapp-log.ts";
import { PasskeyError, registerVaultPasskey } from "../lib/vault-passkey.ts";
import { startVaultIdleLock, subscribeVaultLockReset, subscribeVaultLockWarning } from "../lib/vault-idle-lock.ts";
import "../components/vault/vault-lock-notice.css";

type EnsureReason = "setup" | "unlock" | "secrets" | "vault-page";

type VaultContextValue = {
  unlocked: boolean;
  address: string | null;
  pxeAccount: ImportedAztecAccount | null;
  secretsVisible: boolean;
  vaultAvailable: boolean;
  refreshVaultAvailability: () => Promise<boolean>;
  setPxeAccount: (account: ImportedAztecAccount | null) => void;
  requireVaultAfterPxeImport: (account: ImportedAztecAccount) => Promise<void>;
  /**
   * Unlock IndexedDB vault with password (+ passkey) and restore stored DF Punk account.
   * No JSON re-import required when wallets doc exists.
   */
  unlockExistingVault: (aztecAddress?: string) => Promise<ImportedAztecAccount | null>;
  ensureUnlocked: (
    reason?: EnsureReason,
    account?: ImportedAztecAccount | null,
  ) => Promise<boolean>;
  lock: () => void;
  requestUnlock: () => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}

function isUsableVaultAccount(account: ImportedAztecAccount | null | undefined): boolean {
  if (!account?.address?.trim()) return false;
  // Nulo stores address only — keys stay in the extension.
  if (account.connector === "nulo") return true;
  return !!account.signingKey?.trim();
}

async function loadAccountFromUnlockedVault(
  preferredAddress?: string | null,
): Promise<ImportedAztecAccount | null> {
  if (preferredAddress) {
    const one = await getStoredAztecWallet(preferredAddress);
    if (isUsableVaultAccount(one)) return one;
  }
  const all = await listStoredAztecWallets();
  return all.find((a) => isUsableVaultAccount(a)) ?? all[0] ?? null;
}

export function VaultProvider(props: { children: ReactNode }) {
  const { closeWalletPanel } = useUi();
  const [pxeAccount, setPxeAccountState] = useState<ImportedAztecAccount | null>(null);
  const pxeAccountRef = useRef<ImportedAztecAccount | null>(null);
  const [unlocked, setUnlocked] = useState(() => isVaultUnlocked());
  const [lockDeadline, setLockDeadline] = useState<number | null>(null);
  const [lockSeconds, setLockSeconds] = useState(60);
  const [lockResetNotice, setLockResetNotice] = useState(false);
  const [warningClosing, setWarningClosing] = useState(false);
  const [noticeSeconds, setNoticeSeconds] = useState(5);
  const [address, setAddress] = useState<string | null>(() => getVaultSession()?.address ?? null);
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<VaultModalMode>("unlock");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalPasskeyRequired, setModalPasskeyRequired] = useState(false);
  const [modalPasskeyRecovery, setModalPasskeyRecovery] = useState(false);
  const [modalAddress, setModalAddress] = useState<string | null>(null);

  const pendingResolve = useRef<((ok: boolean) => void) | null>(null);

  const refreshVaultAvailability = useCallback(async () => {
    const exists = await hasAnyVaultProfile();
    setVaultAvailable(exists);
    return exists;
  }, []);

  useEffect(() => {
    void refreshVaultAvailability();
  }, [refreshVaultAvailability]);

  useEffect(() => {
    let wasUnlocked = isVaultUnlocked();
    return subscribeVault(() => {
      const s = getVaultSession();
      const nowUnlocked = !!s?.unlocked;
      setUnlocked(nowUnlocked);
      setAddress(s?.address ?? null);
      if (wasUnlocked && !nowUnlocked) {
        pxeAccountRef.current = null;
        setPxeAccountState(null);
      }
      wasUnlocked = nowUnlocked;
      void refreshVaultAvailability();
    });
  }, [refreshVaultAvailability]);

  useEffect(() => startVaultIdleLock(), []);
  useEffect(() => subscribeVaultLockWarning(setLockDeadline), []);
  useEffect(() => {
    if (lockDeadline === null) return;
    const tick = () => setLockSeconds(Math.max(0, Math.ceil((lockDeadline - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockDeadline]);
  useEffect(() => subscribeVaultLockReset(() => {
      setWarningClosing(true);
      setLockResetNotice(true);
  }), []);
  useEffect(() => {
    if (!warningClosing) return;
    const timer = window.setTimeout(() => setWarningClosing(false), 800);
    return () => window.clearTimeout(timer);
  }, [warningClosing]);
  useEffect(() => {
    if (!lockResetNotice) return;
    const deadline = Date.now() + 5000;
    setNoticeSeconds(5);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (remaining === 0) setLockResetNotice(false);
      else setNoticeSeconds(remaining);
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [lockResetNotice]);

  const finishModal = useCallback((ok: boolean) => {
    setModalOpen(false);
    setModalBusy(false);
    setModalError(null);
    setModalPasskeyRequired(false);
    setModalPasskeyRecovery(false);
    pendingResolve.current?.(ok);
    pendingResolve.current = null;
  }, []);

  const openModal = useCallback(
    (mode: VaultModalMode, _required: boolean, aztecAddress?: string) =>
      new Promise<boolean>((resolve) => {
        if (mode === "unlock" && isVaultUnlocked()) {
          resolve(true);
          return;
        }
        closeWalletPanel();
        pendingResolve.current?.(false);
        pendingResolve.current = resolve;
        setModalMode(mode);
        setModalError(null);
        setModalPasskeyRequired(false);
        setModalPasskeyRecovery(false);
        setModalAddress(aztecAddress ?? null);
        setModalOpen(true);
        if (mode === "unlock" && aztecAddress) {
          void getVaultProfile(aztecAddress).then((meta) => {
            setModalPasskeyRequired(!!meta?.passkey);
          });
        }
        pushDappLog({
          kind: "info",
          title: mode === "setup" ? "Set vault password + passkey" : "Unlock vault",
          detail:
            mode === "setup"
              ? "Choose an admin password (at least 12 characters) and register a device / phone passkey."
              : "Enter your vault password — then approve passkey if one was registered.",
          ttlMs: 10_000,
        });
      }),
    [closeWalletPanel],
  );

  const setPxeAccount = useCallback((account: ImportedAztecAccount | null) => {
    pxeAccountRef.current = account;
    setPxeAccountState(account);
    bindVaultAddress(account?.address ?? null);
  }, []);

  const requireVaultAfterPxeImport = useCallback(
    async (account: ImportedAztecAccount) => {
      setPxeAccount(account);
      const exists = await hasVaultProfile(account.address);
      if (!exists) {
        const ok = await openModal("setup", true, account.address);
        if (!ok) throw new VaultError("Vault password is required after PXE import.");
      }
      await refreshVaultAvailability();
    },
    [openModal, refreshVaultAvailability, setPxeAccount],
  );

  const ensureUnlocked = useCallback(
    async (_reason: EnsureReason = "secrets", account?: ImportedAztecAccount | null) => {
      if (isVaultUnlocked()) return true;
      if (account) setPxeAccount(account);
      const active = account ?? pxeAccountRef.current;

      if (active?.address) {
        const exists = await hasVaultProfile(active.address);
        return openModal(exists ? "unlock" : "setup", false, active.address);
      }

      const profiles = await listVaultProfiles();
      const first = profiles[0];
      if (!first) {
        pushDappLog({
          kind: "error",
          title: "No vault yet",
          detail:
            "Import the full DF Punk dfpunk-account-*.json (Download account info), then set a vault password.",
        });
        return false;
      }
      return openModal("unlock", false, first.aztecAddress);
    },
    [openModal, setPxeAccount],
  );

  const unlockExistingVault = useCallback(
    async (aztecAddress?: string) => {
      if (isVaultUnlocked()) {
        const restored = await loadAccountFromUnlockedVault(
          aztecAddress ?? getVaultSession()?.address ?? pxeAccountRef.current?.address,
        );
        if (restored) setPxeAccount(restored);
        return restored;
      }

      let address = aztecAddress?.trim() || "";
      if (!address) {
        const profiles = await listVaultProfiles();
        address = profiles[0]?.aztecAddress ?? "";
      }
      if (!address) {
        throw new VaultError("No IndexedDB vault found. Import DF Punk JSON first.");
      }

      const ok = await openModal("unlock", true, address);
      if (!ok) return null;

      const restored = await loadAccountFromUnlockedVault(address);
      if (!isUsableVaultAccount(restored)) {
        throw new VaultError(
          "Vault unlocked, but no usable Aztec account is stored. Import dfpunk-account-*.json from DF client “Download account info”, or create a Dark Forest Aztec 6.0 account.",
        );
      }
      setPxeAccount(restored);
      return restored;
    },
    [openModal, setPxeAccount],
  );

  const requestUnlock = useCallback(() => {
    void ensureUnlocked("secrets");
  }, [ensureUnlocked]);

  const lock = useCallback(() => {
    lockVault();
  }, []);

  const onSubmitPassword = useCallback(
    async (password: string, opts: { registerPasskey: boolean }) => {
      const active = pxeAccountRef.current;
      const unlockAddr = modalAddress ?? active?.address ?? null;

      setModalBusy(true);
      setModalError(null);
      setModalPasskeyRecovery(false);
      try {
        if (modalMode === "setup") {
          if (!active?.address) {
            setModalError("Missing DF Punk account. Import dfpunk-account-*.json first.");
            setModalBusy(false);
            return;
          }
          let registered = null as Awaited<ReturnType<typeof registerVaultPasskey>> | null;
          if (opts.registerPasskey) {
            pushDappLog({
              kind: "info",
              title: "Register passkey",
              detail: "Approve the passkey twice: once to create it, once to wrap the vault key.",
              ttlMs: 20_000,
            });
            registered = await registerVaultPasskey({ aztecAddress: active.address });
          }
          await setupVault({
            aztecAddress: active.address,
            password,
            signingKey: active.signingKey,
            passkey: registered?.meta,
            prfSecret: registered?.prfSecret,
          });
          pushDappLog({
            kind: "announce",
            title: registered ? "Vault + passkey created" : "Vault created",
            detail: registered
              ? "The password and passkey together wrap the vault key. The password alone cannot decrypt it."
              : "Password-locked IndexedDB vault is ready. The password is the encryption key.",
            ttlMs: 12_000,
          });
        } else {
          if (!unlockAddr) {
            setModalError("No vault profile address selected.");
            setModalBusy(false);
            return;
          }
          if (modalPasskeyRequired) {
            pushDappLog({
              kind: "info",
              title: "Passkey required",
              detail: "Approve biometric / PIN / phone after password check…",
              ttlMs: 20_000,
            });
          }
          await unlockVault({
            aztecAddress: unlockAddr,
            password,
            signingKey: active?.signingKey,
          });
          const restored = await loadAccountFromUnlockedVault(unlockAddr);
          if (restored) setPxeAccount(restored);
          pushDappLog({
            kind: "info",
            title: "Vault unlocked",
            detail: restored
              ? "DF Punk wallet restored from IndexedDB — registering into PXE next."
              : "Secrets are readable for this session.",
            ttlMs: 8_000,
          });
        }
        await refreshVaultAvailability();
        finishModal(true);
      } catch (e) {
        setModalBusy(false);
        const msg = e instanceof Error ? e.message : String(e);
        setModalError(msg);
        if (
          modalMode === "unlock" &&
          e instanceof PasskeyError &&
          (e.code === "host_mismatch" || e.code === "missing_on_device" || e.code === "cancelled")
        ) {
          setModalPasskeyRecovery(true);
        }
      }
    },
    [
      finishModal,
      modalAddress,
      modalMode,
      modalPasskeyRequired,
      refreshVaultAvailability,
      setPxeAccount,
    ],
  );

  const onReplacePasskey = useCallback(
    async (password: string) => {
      const active = pxeAccountRef.current;
      const unlockAddr = modalAddress ?? active?.address ?? null;
      if (!unlockAddr) {
        setModalError("No vault profile address selected.");
        return;
      }
      setModalBusy(true);
      setModalError(null);
      try {
        const profile = await getVaultProfile(unlockAddr);
        pushDappLog({
          kind: "info",
          title: "Replace passkey",
          detail: profile?.cekWrap
            ? "Approve the current passkey, then register a new one. The new passkey wraps the vault key."
            : "Password check, then register a new passkey for this host…",
          ttlMs: 20_000,
        });
        await unlockVault({
          aztecAddress: unlockAddr,
          password,
          signingKey: active?.signingKey,
          skipPasskey: !profile?.cekWrap,
        });
        const registered = await registerVaultPasskey({ aztecAddress: unlockAddr });
        await attachVaultPasskey(registered.meta, {
          password,
          prfSecret: registered.prfSecret,
        });
        const restored = await loadAccountFromUnlockedVault(unlockAddr);
        if (restored) setPxeAccount(restored);
        pushDappLog({
          kind: "announce",
          title: "Passkey replaced",
          detail: `New passkey registered for ${window.location.hostname}. Vault unlocked.`,
          ttlMs: 12_000,
        });
        await refreshVaultAvailability();
        finishModal(true);
      } catch (e) {
        setModalBusy(false);
        setModalError(e instanceof Error ? e.message : String(e));
        setModalPasskeyRecovery(true);
      }
    },
    [finishModal, modalAddress, refreshVaultAvailability, setPxeAccount],
  );

  const onRecoverViaJson = useCallback(
    async (password: string) => {
      const active = pxeAccountRef.current;
      const unlockAddr = modalAddress ?? active?.address ?? null;
      if (!unlockAddr) {
        setModalError("No vault profile address selected.");
        return;
      }
      const confirmed = window.confirm(
        "Wipe this host’s IndexedDB vault for this address after password check?\n\n" +
          "You must re-import dfpunk-account-*.json and set a new password (+ passkey). " +
          "Claim credentials JSON downloads are separate and are not deleted.",
      );
      if (!confirmed) return;
      setModalBusy(true);
      setModalError(null);
      try {
        await wipeVaultProfileWithPassword({
          aztecAddress: unlockAddr,
          password,
          signingKey: active?.signingKey,
        });
        setPxeAccount(null);
        pushDappLog({
          kind: "announce",
          title: "Vault wiped on this host",
          detail: "Import DF Punk JSON again, then create a new vault + passkey for this site.",
          ttlMs: 16_000,
        });
        await refreshVaultAvailability();
        finishModal(false);
      } catch (e) {
        setModalBusy(false);
        setModalError(e instanceof Error ? e.message : String(e));
        setModalPasskeyRecovery(true);
      }
    },
    [finishModal, modalAddress, refreshVaultAvailability, setPxeAccount],
  );

  const secretsVisible = !!(pxeAccount && unlocked);

  const value = useMemo<VaultContextValue>(
    () => ({
      unlocked,
      address,
      pxeAccount,
      secretsVisible,
      vaultAvailable,
      refreshVaultAvailability,
      setPxeAccount,
      requireVaultAfterPxeImport,
      unlockExistingVault,
      ensureUnlocked,
      lock,
      requestUnlock,
    }),
    [
      unlocked,
      address,
      pxeAccount,
      secretsVisible,
      vaultAvailable,
      refreshVaultAvailability,
      setPxeAccount,
      requireVaultAfterPxeImport,
      unlockExistingVault,
      ensureUnlocked,
      lock,
      requestUnlock,
    ],
  );

  return (
    <VaultContext.Provider value={value}>
      {props.children}
      <div className="vault-lock-notifications">
      {(warningClosing || (!lockResetNotice && lockDeadline !== null)) && (
        <div className={`vault-lock-warning${warningClosing ? " is-closing" : ""}`} role="status" aria-live="polite">
          <span className="vault-lock-warning-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div className="vault-lock-warning-copy">
            <><strong>Vault locks in {lockSeconds}s</strong><span>Click or press any key to stay unlocked.</span></>
          </div>
        </div>
      )}
      {lockResetNotice && (
        <div className="vault-lock-warning is-reset" role="status" aria-live="polite">
          <button type="button" className="icon-btn vault-lock-notice-dismiss" aria-label="Dismiss auto-lock reset notification" onClick={() => setLockResetNotice(false)} />
          <span className="vault-lock-warning-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16 9.5" /></svg></span>
          <div className="vault-lock-warning-copy"><strong>Auto-lock timer reset</strong><span>Your vault stays unlocked.</span></div>
          <span className="vault-lock-notice-countdown" aria-label={`Closes in ${noticeSeconds} seconds`}>{noticeSeconds}s</span>
        </div>
      )}
      </div>
      <VaultUnlockModal
        open={modalOpen}
        mode={modalMode}
        aztecAddress={modalAddress ?? pxeAccount?.address ?? address}
        busy={modalBusy}
        error={modalError}
        passkeyRequired={modalPasskeyRequired}
        passkeyRecovery={modalPasskeyRecovery}
        onSubmit={onSubmitPassword}
        onReplacePasskey={modalPasskeyRecovery ? onReplacePasskey : undefined}
        onRecoverViaJson={modalPasskeyRecovery ? onRecoverViaJson : undefined}
        onCancel={() => finishModal(false)}
      />
    </VaultContext.Provider>
  );
}
