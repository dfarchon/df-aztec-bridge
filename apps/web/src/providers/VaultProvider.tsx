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
  hasVaultProfile,
  isVaultUnlocked,
  lockVault,
  setupVault,
  subscribeVault,
  unlockVault,
  VaultError,
} from "../lib/vault.ts";
import {
  VaultUnlockModal,
  type VaultModalMode,
} from "../components/vault/VaultUnlockModal.tsx";
import { useUi } from "./UiProvider.tsx";
import { pushDappLog } from "../lib/dapp-log.ts";
import { registerVaultPasskey } from "../lib/vault-passkey.ts";
type EnsureReason = "setup" | "unlock" | "secrets" | "vault-page";

type VaultContextValue = {
  unlocked: boolean;
  address: string | null;
  pxeAccount: ImportedAztecAccount | null;
  secretsVisible: boolean;
  setPxeAccount: (account: ImportedAztecAccount | null) => void;
  /** After successful PXE import: require setup if no profile. */
  requireVaultAfterPxeImport: (account: ImportedAztecAccount) => Promise<void>;
  /** Pass `account` when React state may not have flushed yet (post-import). */
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

export function VaultProvider(props: { children: ReactNode }) {
  const { closeWalletPanel } = useUi();
  const [pxeAccount, setPxeAccountState] = useState<ImportedAztecAccount | null>(null);
  const pxeAccountRef = useRef<ImportedAztecAccount | null>(null);
  const [unlocked, setUnlocked] = useState(() => isVaultUnlocked());
  const [address, setAddress] = useState<string | null>(() => getVaultSession()?.address ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<VaultModalMode>("unlock");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalRequired, setModalRequired] = useState(false);
  const [modalPasskeyRequired, setModalPasskeyRequired] = useState(false);

  const pendingResolve = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    return subscribeVault(() => {
      const s = getVaultSession();
      setUnlocked(!!s?.unlocked);
      setAddress(s?.address ?? null);
    });
  }, []);

  const finishModal = useCallback((ok: boolean) => {
    setModalOpen(false);
    setModalBusy(false);
    setModalError(null);
    setModalRequired(false);
    setModalPasskeyRequired(false);
    pendingResolve.current?.(ok);
    pendingResolve.current = null;
  }, []);

  const openModal = useCallback(
    (mode: VaultModalMode, required: boolean, aztecAddress?: string) =>
      new Promise<boolean>((resolve) => {
        if (mode === "unlock" && isVaultUnlocked()) {
          resolve(true);
          return;
        }
        // Password modal must sit above the wallet drawer.
        closeWalletPanel();
        pendingResolve.current?.(false);
        pendingResolve.current = resolve;
        setModalMode(mode);
        setModalRequired(required);
        setModalError(null);
        setModalPasskeyRequired(false);
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
              ? "Choose an admin password (min 8 chars) and register a device / phone passkey."
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
    },
    [openModal, setPxeAccount],
  );

  const ensureUnlocked = useCallback(
    async (_reason: EnsureReason = "secrets", account?: ImportedAztecAccount | null) => {
      if (isVaultUnlocked()) return true;
      const active = account ?? pxeAccountRef.current;
      if (account) setPxeAccount(account);
      if (!active?.signingKey?.trim()) {
        setModalError("Connect DF Punk PXE first (signingKey required to unlock).");
        pushDappLog({
          kind: "error",
          title: "Vault unlock blocked",
          detail: "Import DF Punk → PXE first so signingKey is in memory for password verification.",
        });
        return false;
      }
      const exists = await hasVaultProfile(active.address);
      return openModal(exists ? "unlock" : "setup", false, active.address);
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
      if (!active?.signingKey?.trim()) {
        setModalError("Missing PXE signingKey. Re-import DF Punk → PXE.");
        return;
      }
      setModalBusy(true);
      setModalError(null);
      try {
        if (modalMode === "setup") {
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
          if (modalPasskeyRequired) {
            pushDappLog({
              kind: "info",
              title: "Passkey required",
              detail: "Approve biometric / PIN / phone after password check…",
              ttlMs: 20_000,
            });
          }
          await unlockVault({
            aztecAddress: active.address,
            password,
            signingKey: active.signingKey,
          });
          pushDappLog({
            kind: "info",
            title: "Vault unlocked",
            detail: "Secrets are readable for this session.",
            ttlMs: 8_000,
          });
        }
        finishModal(true);
      } catch (e) {
        setModalBusy(false);
        setModalError(e instanceof Error ? e.message : String(e));
      }
    },
    [finishModal, modalMode, modalPasskeyRequired],
  );

  const secretsVisible = !!(pxeAccount && unlocked);

  const value = useMemo<VaultContextValue>(
    () => ({
      unlocked,
      address,
      pxeAccount,
      secretsVisible,
      setPxeAccount,
      requireVaultAfterPxeImport,
      ensureUnlocked,
      lock,
      requestUnlock,
    }),
    [
      unlocked,
      address,
      pxeAccount,
      secretsVisible,
      setPxeAccount,
      requireVaultAfterPxeImport,
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
        aztecAddress={pxeAccount?.address ?? address}
        busy={modalBusy}
        error={modalError}
        passkeyRequired={modalPasskeyRequired}
        onSubmit={onSubmitPassword}
        onCancel={modalRequired ? undefined : () => finishModal(false)}
      />
    </VaultContext.Provider>
  );
}
