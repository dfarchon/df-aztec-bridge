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
  unlockAndReplacePasskey,
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
import { startVaultIdleLock } from "../lib/vault-idle-lock.ts";

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

async function loadAccountFromUnlockedVault(
  preferredAddress?: string | null,
): Promise<ImportedAztecAccount | null> {
  if (preferredAddress) {
    const one = await getStoredAztecWallet(preferredAddress);
    if (one?.signingKey?.trim()) return one;
  }
  const all = await listStoredAztecWallets();
  return all.find((a) => !!a.signingKey?.trim()) ?? all[0] ?? null;
}

export function VaultProvider(props: { children: ReactNode }) {
  const { closeWalletPanel } = useUi();
  const [pxeAccount, setPxeAccountState] = useState<ImportedAztecAccount | null>(null);
  const pxeAccountRef = useRef<ImportedAztecAccount | null>(null);
  const [unlocked, setUnlocked] = useState(() => isVaultUnlocked());
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
      if (!restored?.signingKey?.trim()) {
        throw new VaultError(
          "Vault unlocked, but no full DF Punk wallet JSON is stored. Import dfpunk-account-*.json from DF client “Download account info”.",
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
          let passkey = null as Awaited<ReturnType<typeof registerVaultPasskey>> | null;
          if (opts.registerPasskey) {
            pushDappLog({
              kind: "info",
              title: "Register passkey",
              detail: "Approve Face ID / fingerprint / phone or security key…",
              ttlMs: 20_000,
            });
            passkey = await registerVaultPasskey({ aztecAddress: active.address });
          }
          await setupVault({
            aztecAddress: active.address,
            password,
            signingKey: active.signingKey,
            passkey,
          });
          pushDappLog({
            kind: "announce",
            title: passkey ? "Vault + passkey created" : "Vault created",
            detail: passkey
              ? "Password encrypts secrets; passkey is required on every unlock."
              : "Password-locked IndexedDB vault is ready (no passkey).",
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
        pushDappLog({
          kind: "info",
          title: "Replace passkey",
          detail: "Password check, then register a new passkey for this host…",
          ttlMs: 20_000,
        });
        await unlockVault({
          aztecAddress: unlockAddr,
          password,
          signingKey: active?.signingKey,
          skipPasskey: true,
        });
        const passkey = await registerVaultPasskey({ aztecAddress: unlockAddr });
        await attachVaultPasskey(passkey);
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
