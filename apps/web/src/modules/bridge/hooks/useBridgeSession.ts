import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, formatUnits, type Hex } from "viem";
import {
  bridgeFromConnectedWallet,
  connectEvmWalletDetail,
  connectWalletConnect,
  disconnectWalletConnect,
  discoverWallets,
  formatWalletError,
  getFeeJuiceBalance,
  getL1PublicClient,
  isWalletUserRejection,
  resumePendingBridge,
  switchWalletChain,
  watchProviderSession,
  computeBridgeFee,
  BRIDGE_FEE_BPS,
  parseEthFeeWeiOverride,
  resolveBridgeEthServiceFee,
  shouldChargeBridgeEthServiceFee,
  type BridgeProgressPhase,
  type ClaimCredentials,
  type ConnectedWallet,
  type EIP6963ProviderDetail,
  type FeeJuiceBalance,
  type PendingBridge,
} from "@df-bridge/browser-sdk";
import {
  DEFAULT_NETWORK_ID,
  getNetwork,
  type WebNetworkConfig,
} from "../../../config/networks.ts";

type NetworkMeta = WebNetworkConfig;
import {
  assertDfClientAccount,
  readAccountFile,
  type ImportedAztecAccount,
} from "../../../lib/account-import.ts";
import {
  assertBridgeStorageReady,
  BridgeStorageError,
  getActiveSession,
  listIncompleteSessions,
  normalizeL1TxHash,
  removeSession,
  setActiveSession,
  upsertSession,
  type BridgeSessionEntry,
} from "../../../lib/bridge-session.ts";
import { phaseLabel, recoverySteps, selectSessionForUi, shortHash } from "../../../lib/claim-recovery.ts";
import {
  amountQuickFill,
  bridgeShortfall,
  formatFjAmount,
  MIN_BRIDGE_FJ,
  parseBridgeAmount,
} from "../../../lib/bridge-amount.ts";
import { parseClaimCredentialsFile } from "../../../lib/claim-credentials-import.ts";
import {
  downloadClaimCredentials,
  downloadJson,
} from "../../../lib/claim-credentials-store.ts";
import {
  advanceProgress,
  bridgePhaseStep,
  claimPhaseStep,
  finishProgress,
  shouldBlockUnload,
  startProgress,
  type ProgressState,
} from "../../../lib/progress-track.ts";
import {
  hasRpcOverrides,
} from "../../../lib/rpc-overrides.ts";
import { formatDappError, logDappError, pushDappLog, pushL1TxDappLog, pushL2TxDappLog } from "../../../lib/dapp-log.ts";
import { importDfPunkFileIntoPxe, registerDfPunkAccountIntoPxe } from "../../../lib/df-pxe-import.ts";
import { saveAztecWallet } from "../../../lib/aztec-wallet-store.ts";
import {
  AZTEC_MAINNET_NODE_PUBLIC,
  OFFICIAL_DOCS_FEE_JUICE,
} from "../../../lib/official-links.ts";
import {
  isSponsoredFpcAddress,
} from "../../../lib/sponsored-fpc.ts";
import {
  assertBridgeReadyDfPxeAccount,
  isBridgeReadyDfPxeAccount,
} from "../../../lib/df-pxe-bridge-guard.ts";
import {
  isTrustedConnector,
  validateConnectedWalletSession,
} from "../../../lib/wallet-session-guard.ts";
import { LEGACY_WALLET_RDNS } from "@df-bridge/browser-sdk";
import { usePath, useNavigate } from "../../../app/router.tsx";
import { ROUTES } from "../../../app/routes.ts";
import { useNetwork } from "../../../providers/NetworkProvider.tsx";
import { useVault } from "../../../providers/VaultProvider.tsx";
import { useUi } from "../../../providers/UiProvider.tsx";
import { assertSafeClaimApiBase } from "../../../lib/api-base.ts";
import {
  API_BASE,
  BROWSER_CLAIM,
  BRIDGE_ETH_FEE_WEI_OVERRIDE,
  BRIDGE_FEE_RECIPIENT,
  BRIDGE_PUBLIC_URL,
  DFPUNK_PLAY_URL,
  WC_PROJECT_ID,
} from "../config.ts";
import { loadInitialSession, loadInitialSessions, storageErrorMessage } from "../tools.ts";

/** Wallet, PXE import, balances, and browser session state for the bridge shell. */
export function useBridgeSession() {
  const path = usePath();
  const navigate = useNavigate();
  const networkApi = useNetwork();
  const {
    networkId,
    networkMeta,
    l1Backend,
    rpcOverrides,
    settingsOpen,
    openSettings,
    closeSettings,
    draftAztecUrl,
    setDraftAztecUrl,
    draftL1RpcUrl,
    setDraftL1RpcUrl,
    saveSettings,
    resetSettingsDraft,
  } = networkApi;

  const {
    setPxeAccount: setVaultPxeAccount,
    requireVaultAfterPxeImport,
    ensureUnlocked,
    unlockExistingVault,
    vaultAvailable,
    refreshVaultAvailability,
    secretsVisible,
    requestUnlock,
    lock: lockVaultUi,
  } = useVault();
  const { setShellReady, shellReady, closeWalletPanel } = useUi();

  const [feeJuiceDetailsOpen, setFeeJuiceDetailsOpen] = useState(false);
  const [bridgeConfirmOpen, setBridgeConfirmOpen] = useState(false);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoveryPromptOpen, setRecoveryPromptOpen] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletConnectError, setWalletConnectError] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [pxeAddressCopied, setPxeAddressCopied] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [ethSessionOk, setEthSessionOk] = useState(false);
  const [dfPxeAccount, setDfPxeAccount] = useState<ImportedAztecAccount | null>(null);
  const [gateImportingPxe, setGateImportingPxe] = useState(false);
  const [gateUnlockingVault, setGateUnlockingVault] = useState(false);
  const [gateImportError, setGateImportError] = useState<string | null>(null);
  const walletPickerRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amountFj, setAmountFj] = useState("");
  /** When false: L1 bridge only — no L2 secret needed. */
  const [autoClaim, setAutoClaim] = useState(false);
  const [l2Secret, setL2Secret] = useState("");
  const [l2Salt, setL2Salt] = useState("");
  const [l2SigningKey, setL2SigningKey] = useState("");
  /** Try initializerless and secret-derived signing keys when the 5.2 address misses the backup. */
  const [legacyAccountStyles, setLegacyAccountStyles] = useState(true);
  const [showL2Secret, setShowL2Secret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ethServiceFeeWei, setEthServiceFeeWei] = useState<bigint | null>(null);
  const [bridgePhase, setBridgePhase] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [l1TxHash, setL1TxHash] = useState<string | null>(null);
  /**
   * Only a bridge started on this page shows its result cards. A session
   * restored from storage still seeds the state above (an API claim job needs it
   * to keep polling), but it belongs to the Recover tab, not the Bridge form.
   */
  const [showBridgeResult, setShowBridgeResult] = useState(false);
  const [credentials, setCredentials] = useState<ClaimCredentials | null>(null);
  const [claimJobId, setClaimJobId] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState<string | null>(null);
  const [l2TxHash, setL2TxHash] = useState<string | null>(null);
  const [feeBalance, setFeeBalance] = useState<FeeJuiceBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [l2FeeBalance, setL2FeeBalance] = useState<bigint | null>(null);
  const [l2BalanceError, setL2BalanceError] = useState<string | null>(null);
  const [l2BalanceRefreshing, setL2BalanceRefreshing] = useState(false);
  const [importedAccounts, setImportedAccounts] = useState<ImportedAztecAccount[]>([]);
  const [importedIndex, setImportedIndex] = useState(0);
  const [importName, setImportName] = useState<string | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [credentialsImportError, setCredentialsImportError] = useState<string | null>(null);
  const [credentialsImportNotice, setCredentialsImportNotice] = useState<string | null>(null);

  // Multi-session claim recovery (Recover tab).
  const [recoverySessions, setRecoverySessions] = useState<BridgeSessionEntry[]>([]);
  const [selectedRecoveryHash, setSelectedRecoveryHash] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState<boolean | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const selectedSession = selectSessionForUi(recoverySessions, selectedRecoveryHash);

  const refreshSessions = useCallback(async () => {
    const sessions = await listIncompleteSessions(networkId);
    setRecoverySessions(sessions);
    return sessions;
  }, [networkId]);

  useEffect(() => {
    if (!shellReady) closeWalletPanel();
  }, [shellReady, closeWalletPanel]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadInitialSession(networkId);
      const sessions = await loadInitialSessions(networkId);
      if (cancelled) return;
      setRecoverySessions(sessions);
      if (session) {
        setSelectedRecoveryHash(session.l1TxHash);
        setL1TxHash(session.l1TxHash);
        setCredentials(session.credentials ?? null);
        setClaimJobId(session.claimJobId ?? null);
        if (session.credentials) setRecoveryPromptOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkId]);

  type AccountImportOptions = {
    expectedRecipient?: string;
    forRecovery?: boolean;
  };

  const applyImportedAccount = useCallback(
    (account: ImportedAztecAccount, opts?: AccountImportOptions) => {
      if (
        opts?.expectedRecipient &&
        account.address.toLowerCase() !== opts.expectedRecipient.toLowerCase()
      ) {
        setError(
          `This account does not match the saved claim recipient ${opts.expectedRecipient}.`,
        );
        return;
      }
      setRecipient(account.address);
      setL2Secret(account.secretKey);
      setL2Salt(account.salt);
      setL2SigningKey(account.signingKey ?? "");
      if (isBridgeReadyDfPxeAccount(account, wallet?.address)) {
        setDfPxeAccount(account);
        setVaultPxeAccount(account);
        setAutoClaim(true);
        void requireVaultAfterPxeImport(account).catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        });
      } else if (!opts?.forRecovery) {
        // Manual / non-PXE imports do not unlock bridge.
        setDfPxeAccount(null);
        setVaultPxeAccount(null);
      }
      if (opts?.forRecovery) {
        setError(null);
        setBridgePhase("Recovery account verified — ready to resume claim");
      } else if (isBridgeReadyDfPxeAccount(account, wallet?.address)) {
        setError(null);
        setBridgePhase("DF Punk PXE session ready — bridge unlocked");
      }
    },
    [wallet?.address, setVaultPxeAccount, requireVaultAfterPxeImport],
  );

  const importPxeFromGate = useCallback(
    async (file: File) => {
      if (!ethSessionOk || !wallet) {
        setGateImportError("Validate MetaMask / WalletConnect first — DF Punk PXE stays locked.");
        return;
      }
      if (!BROWSER_CLAIM) {
        setGateImportError("Browser PXE is disabled — cannot register the DF account in PXE.");
        return;
      }
      if (!networkMeta?.aztecNodeUrl) {
        setGateImportError("Select a network with an Aztec node URL first (Settings).");
        return;
      }

      setGateImportingPxe(true);
      setGateImportError(null);
      setBridgePhase(`Importing ${file.name} into PXE…`);
      try {
        const stored = await importDfPunkFileIntoPxe({
          file,
          ethWallet: wallet,
          networkId,
          aztecNodeUrl: networkMeta.aztecNodeUrl,
          onProgress: (detail) => setBridgePhase(detail),
        });
        await requireVaultAfterPxeImport(stored);
        const ok = await ensureUnlocked("secrets", stored);
        if (!ok) throw new Error("Vault password required after PXE import.");
        await saveAztecWallet(stored);
        await refreshVaultAvailability();
        applyImportedAccount(stored);
        pushDappLog({
          kind: "announce",
          title: "DF Punk PXE session ready",
          detail: `Bound ${shortHash(stored.address)} to ${shortHash(wallet.address)}.`,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setGateImportError(message);
        logDappError(e, "Import DF Punk → PXE failed");
      } finally {
        setGateImportingPxe(false);
      }
    },
    [
      ethSessionOk,
      wallet,
      networkMeta?.aztecNodeUrl,
      networkId,
      requireVaultAfterPxeImport,
      ensureUnlocked,
      refreshVaultAvailability,
      applyImportedAccount,
    ],
  );

  const unlockVaultFromGate = useCallback(async () => {
    if (!ethSessionOk || !wallet) {
      setGateImportError("Validate MetaMask / WalletConnect first — vault unlock stays locked.");
      return;
    }
    if (!BROWSER_CLAIM) {
      setGateImportError("Browser PXE is disabled — cannot register the DF account in PXE.");
      return;
    }
    if (!networkMeta?.aztecNodeUrl) {
      setGateImportError("Select a network with an Aztec node URL first (Settings).");
      return;
    }

    setGateUnlockingVault(true);
    setGateImportError(null);
    setBridgePhase("Unlocking IndexedDB vault…");
    try {
      const restored = await unlockExistingVault();
      if (!restored) throw new Error("Vault unlock cancelled.");
      assertDfClientAccount(restored);
      let stored: ImportedAztecAccount = { ...restored, fromDfClient: true };
      if (restored.pxeRegistered) {
        setBridgePhase("Vault unlocked — using the saved PXE account.");
      } else {
        setBridgePhase("Restoring DF Punk wallet into PXE…");
        try {
          stored = await registerDfPunkAccountIntoPxe({
            account: stored,
            ethWallet: wallet,
            networkId,
            aztecNodeUrl: networkMeta.aztecNodeUrl,
            onProgress: (detail) => setBridgePhase(detail),
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/derive/i.test(message)) throw err;
          setBridgePhase(
            "Vault unlocked with the saved address. Re-import the DF JSON if a later claim rejects the keys.",
          );
        }
      }
      await saveAztecWallet(stored);
      applyImportedAccount(stored);
      pushDappLog({
        kind: "announce",
        title: "Vault unlocked → PXE ready",
        detail: `Restored ${shortHash(stored.address)} from IndexedDB, bound to ${shortHash(wallet.address)}.`,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setGateImportError(message);
      logDappError(e, "Unlock vault → PXE failed");
    } finally {
      setGateUnlockingVault(false);
    }
  }, [
    ethSessionOk,
    wallet,
    networkMeta?.aztecNodeUrl,
    networkId,
    unlockExistingVault,
    applyImportedAccount,
  ]);

  const onAccountFile = useCallback(
    async (file: File | null, opts?: AccountImportOptions) => {
      if (!file) return;
      setError(null);
      try {
        const lower = file.name.toLowerCase();
        if (
          !lower.endsWith(".json") &&
          !lower.endsWith(".txt") &&
          file.type &&
          file.type !== "application/json" &&
          file.type !== "text/plain"
        ) {
          throw new Error("Please upload a .json or .txt account backup");
        }
        const accounts = await readAccountFile(file);
        let accountIndex = 0;
        if (opts?.expectedRecipient) {
          accountIndex = accounts.findIndex(
            (account) => account.address.toLowerCase() === opts.expectedRecipient!.toLowerCase(),
          );
          if (accountIndex < 0) {
            throw new Error(
              `No account in this file matches the saved claim recipient ${opts.expectedRecipient}`,
            );
          }
        }
        setImportedAccounts(accounts);
        setImportedIndex(accountIndex);
        setImportName(file.name);
        applyImportedAccount(accounts[accountIndex]!, opts);
      } catch (e: unknown) {
        setImportedAccounts([]);
        setImportName(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [applyImportedAccount],
  );

  const refreshFeeBalance = useCallback(
    async (connected: ConnectedWallet, meta: NetworkMeta, opts?: { spin?: boolean }) => {
      const spin = opts?.spin === true;
      const started = Date.now();
      if (spin) {
        setBalanceRefreshing(true);
        setBalanceError(null);
      }
      try {
        setBalanceError(null);
        // Always read via the network's L1 RPC + expected chain — not the wallet
        // provider — so a wrong MetaMask network cannot break balanceOf.
        const bal = await getFeeJuiceBalance({
          tokenAddress: meta.l1Addresses.feeJuice,
          holder: connected.address,
          chainId: meta.l1ChainId,
          l1RpcUrl: meta.l1RpcUrl,
        });
        setFeeBalance(bal);
      } catch (e: unknown) {
        setFeeBalance(null);
        setBalanceError(e instanceof Error ? e.message : String(e));
      } finally {
        if (spin) {
          const remain = 800 - (Date.now() - started);
          if (remain > 0) await new Promise((r) => setTimeout(r, remain));
          setBalanceRefreshing(false);
        }
      }
    },
    [],
  );

  const refreshL2FeeBalance = useCallback(
    async (aztecAddress: string, aztecNodeUrl: string, opts?: { spin?: boolean }) => {
      if (!BROWSER_CLAIM) {
        setL2FeeBalance(null);
        setL2BalanceError("Browser PXE disabled — L2 Fee Juice balance unavailable.");
        return;
      }
      const spin = opts?.spin === true;
      const started = Date.now();
      if (spin) {
        setL2BalanceRefreshing(true);
        setL2BalanceError(null);
      }
      try {
        setL2BalanceError(null);
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { getAztecFeeJuiceBalance } = await loadBrowserClaim();
        const bal = await getAztecFeeJuiceBalance({
          aztecNodeUrl,
          aztecAddress,
        });
        setL2FeeBalance(bal);
      } catch (e: unknown) {
        setL2FeeBalance(null);
        setL2BalanceError(e instanceof Error ? e.message : String(e));
      } finally {
        if (spin) {
          const remain = 800 - (Date.now() - started);
          if (remain > 0) await new Promise((r) => setTimeout(r, remain));
          setL2BalanceRefreshing(false);
        }
      }
    },
    [],
  );

  /** Refresh L1 AZTEC + L2 Fee Juice after bridge / claim finishes. */
  const refreshBalancesAfterAction = useCallback(() => {
    if (wallet && networkMeta) {
      void refreshFeeBalance(wallet, networkMeta, { spin: true });
    }
    if (dfPxeAccount?.address && networkMeta?.aztecNodeUrl) {
      void refreshL2FeeBalance(dfPxeAccount.address, networkMeta.aztecNodeUrl, { spin: true });
    }
  }, [wallet, networkMeta, dfPxeAccount?.address, refreshFeeBalance, refreshL2FeeBalance]);

  // Vault-backed recovery: lazy unlock — do not fail mount while locked.
  useEffect(() => {
    setStorageReady(true);
    setStorageError(null);
  }, []);

  // Keep the recovery session list in sync with storage.
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Keep PXE warm for the active Aztec node (boot already warms the default).
  useEffect(() => {
    if (!BROWSER_CLAIM || !networkMeta?.aztecNodeUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { warmupBrowserClaim } = await loadBrowserClaim();
        if (cancelled) return;
        await warmupBrowserClaim({
          networkId: networkMeta.id,
          aztecNodeUrl: networkMeta.aztecNodeUrl,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          console.warn("[web] PXE re-warmup failed", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkMeta?.id, networkMeta?.aztecNodeUrl]);

  // Auto-update address / chain when user switches in the wallet extension
  useEffect(() => {
    if (!wallet) return;
    return watchProviderSession(wallet.provider, {
      onAccountsChanged: (accounts) => {
        const next = accounts[0] as Hex | undefined;
        if (!next) {
          setWallet(null);
          setFeeBalance(null);
          return;
        }
        setWallet((prev) =>
          prev
            ? {
                ...prev,
                address: next,
              }
            : prev,
        );
      },
      onChainChanged: (chainId) => {
        setWallet((prev) => (prev ? { ...prev, chainId } : prev));
      },
      onDisconnect: () => {
        setWallet(null);
        setFeeBalance(null);
      },
    });
  }, [wallet?.provider]);

  // When UI network changes, ask the wallet to match L1 chainId
  useEffect(() => {
    if (!wallet || !networkMeta) return;
    if (wallet.chainId === networkMeta.l1ChainId) return;
    let cancelled = false;
    void (async () => {
      try {
        await switchWalletChain(wallet.provider, networkMeta.l1ChainId);
        if (cancelled) return;
        setWallet((prev) =>
          prev ? { ...prev, chainId: networkMeta.l1ChainId } : prev,
        );
        setError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        if (isWalletUserRejection(e)) {
          setError(
            `Switched UI to ${networkMeta.name}, but wallet still on chain ${wallet.chainId}. Switch to ${networkMeta.l1ChainId} to bridge.`,
          );
          return;
        }
        setError(formatWalletError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkMeta?.id, networkMeta?.l1ChainId, wallet?.provider, wallet?.chainId]);

  // Refresh L1 Fee Juice / AZTEC balance whenever account or network meta changes
  useEffect(() => {
    if (!wallet || !networkMeta) {
      setFeeBalance(null);
      return;
    }
    void refreshFeeBalance(wallet, networkMeta);
  }, [wallet?.address, wallet?.chainId, networkMeta, refreshFeeBalance]);

  // Refresh L2 Fee Juice for the DF Punk PXE account
  useEffect(() => {
    const ready =
      ethSessionOk &&
      isTrustedConnector(wallet) &&
      isBridgeReadyDfPxeAccount(dfPxeAccount, wallet?.address);
    if (!ready || !dfPxeAccount?.address || !networkMeta?.aztecNodeUrl) {
      setL2FeeBalance(null);
      setL2BalanceError(null);
      return;
    }
    void refreshL2FeeBalance(dfPxeAccount.address, networkMeta.aztecNodeUrl);
  }, [
    ethSessionOk,
    wallet,
    dfPxeAccount,
    networkMeta?.aztecNodeUrl,
    refreshL2FeeBalance,
  ]);

  // Mainnet ETH service fee (~1 L1 tx) preview for the fee recipient treasury.
  useEffect(() => {
    if (!networkMeta || !shouldChargeBridgeEthServiceFee(networkMeta.l1ChainId)) {
      setEthServiceFeeWei(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const publicClient = getL1PublicClient(networkMeta.l1RpcUrl, networkMeta.l1ChainId);
        const wei = await resolveBridgeEthServiceFee({
          chainId: networkMeta.l1ChainId,
          overrideWei: BRIDGE_ETH_FEE_WEI_OVERRIDE,
          getMaxFeePerGas: async () => {
            try {
              const fees = await publicClient.estimateFeesPerGas();
              return fees.maxFeePerGas ?? null;
            } catch {
              return null;
            }
          },
          getGasPrice: () => publicClient.getGasPrice(),
        });
        if (!cancelled) setEthServiceFeeWei(wei > 0n ? wei : null);
      } catch {
        if (!cancelled) setEthServiceFeeWei(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkMeta?.id, networkMeta?.l1ChainId, networkMeta?.l1RpcUrl]);

  const connectDetail = useCallback(
    async (detail: EIP6963ProviderDetail) => {
      setConnectingWallet(true);
      setBusy(true);
      setError(null);
      setWalletConnectError(null);
      setWcUri(null);
      pushDappLog({
        kind: "info",
        title: `Connecting ${detail.info.name}`,
        detail:
          "Check the wallet extension icon for a connect prompt. Close any already-open wallet popup first.",
        ttlMs: 20_000,
      });
      try {
        let connected = await connectEvmWalletDetail(detail);
        if (networkMeta && connected.chainId !== networkMeta.l1ChainId) {
          try {
            await switchWalletChain(connected.provider, networkMeta.l1ChainId);
            connected = await connectEvmWalletDetail(detail);
          } catch (switchErr: unknown) {
            // Connected but wrong network — still usable after user switches manually
            setWallet(connected);
            setPickerOpen(false);
            const msg = isWalletUserRejection(switchErr)
              ? `Connected to ${detail.info.name}, but network switch was cancelled. Switch to chain ${networkMeta.l1ChainId} in the wallet, then bridge.`
              : formatWalletError(switchErr);
            setError(msg);
            setWalletConnectError(msg);
            pushDappLog({ kind: "info", title: "Wallet connected (wrong network)", detail: msg });
            return;
          }
        }
        setWallet(connected);
        setPickerOpen(false);
        setWalletConnectError(null);
        pushDappLog({
          kind: "announce",
          title: `${detail.info.name} connected`,
          detail: `${shortHash(connected.address)} on chain ${connected.chainId}`,
          ttlMs: 12_000,
        });
      } catch (e: unknown) {
        const msg = formatWalletError(e);
        setError(msg);
        setWalletConnectError(msg);
        logDappError(e, `Connect ${detail.info.name} failed`);
      } finally {
        setConnectingWallet(false);
        setBusy(false);
      }
    },
    [networkMeta],
  );

  const onConnectWalletConnect = useCallback(async () => {
    if (!networkMeta) {
      setError("Select a network first.");
      setWalletConnectError("Select a network first.");
      return;
    }
    if (!WC_PROJECT_ID) {
      const msg =
        "Set VITE_WALLETCONNECT_PROJECT_ID in repo-root .env (https://cloud.reown.com), then restart pnpm web.";
      setError(msg);
      setWalletConnectError(msg);
      return;
    }

    setConnectingWallet(true);
    setBusy(true);
    setError(null);
    setWalletConnectError(null);
    setWcUri(null);
    pushDappLog({
      kind: "info",
      title: "WalletConnect",
      detail: "Preparing QR — scan with MetaMask / OKX / Trust on your phone.",
      ttlMs: 15_000,
    });
    try {
      const rpcMap: Record<number, string> = {};
      if (networkMeta.l1RpcUrl) {
        rpcMap[networkMeta.l1ChainId] = networkMeta.l1RpcUrl;
      }

      const connected = await connectWalletConnect({
        projectId: WC_PROJECT_ID,
        chainId: networkMeta.l1ChainId,
        rpcMap: Object.keys(rpcMap).length ? rpcMap : undefined,
        onDisplayUri: (uri) => setWcUri(uri),
      });

      if (connected.chainId !== networkMeta.l1ChainId) {
        try {
          await switchWalletChain(connected.provider, networkMeta.l1ChainId);
        } catch (switchErr: unknown) {
          setWallet(connected);
          setWcUri(null);
          setPickerOpen(false);
          const msg = isWalletUserRejection(switchErr)
            ? `WalletConnect linked, but network switch was cancelled. Switch to chain ${networkMeta.l1ChainId} then bridge.`
            : formatWalletError(switchErr);
          setError(msg);
          setWalletConnectError(msg);
          return;
        }
      }
      setWallet(connected);
      setWcUri(null);
      setPickerOpen(false);
      setWalletConnectError(null);
      pushDappLog({
        kind: "announce",
        title: "WalletConnect linked",
        detail: `${shortHash(connected.address)} on chain ${connected.chainId}`,
      });
    } catch (e: unknown) {
      setWcUri(null);
      const msg = formatWalletError(e);
      setError(msg);
      setWalletConnectError(msg);
      logDappError(e, "WalletConnect failed");
    } finally {
      setConnectingWallet(false);
      setBusy(false);
    }
  }, [networkMeta]);

  const onConnect = useCallback(async () => {
    setError(null);
    setWalletConnectError(null);
    setWcUri(null);
    try {
      const wallets = await discoverWallets(200);
      // Prefer EIP-6963 / named connectors — hide legacy inject-only entry when real wallets announced.
      const trusted = wallets.filter((w) => w.info.rdns !== LEGACY_WALLET_RDNS);
      setAvailableWallets(trusted.length > 0 ? trusted : wallets);
      setPickerOpen(true);
      pushDappLog({
        kind: "info",
        title: "Choose wallet",
        detail:
          trusted.length > 0
            ? `Detected: ${trusted.map((w) => w.info.name).join(", ")}`
            : "No EIP-6963 wallets announced yet — install MetaMask or use WalletConnect.",
        ttlMs: 10_000,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setWalletConnectError(msg);
    }
  }, []);

  const closeWalletPicker = useCallback(() => {
    setPickerOpen(false);
    setWcUri(null);
    setConnectingWallet(false);
    setBusy(false);
  }, []);

  const onDisconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (wallet?.rdns === "walletconnect") {
        await disconnectWalletConnect();
      }
    } catch (e: unknown) {
      setError(formatWalletError(e));
    } finally {
      setWallet(null);
      setEthSessionOk(false);
      setDfPxeAccount(null);
      setVaultPxeAccount(null);
      lockVaultUi();
      setFeeBalance(null);
      setBalanceError(null);
      setBusy(false);
    }
  }, [wallet?.rdns, setVaultPxeAccount, lockVaultUi]);

  const copyWalletAddress = useCallback(async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setAddressCopied(true);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => setAddressCopied(false), 2_000);
    } catch {
      setError("Could not copy the wallet address. Please copy it manually.");
    }
  }, [wallet]);

  const copyPxeAddress = useCallback(async () => {
    const value = recipient.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setPxeAddressCopied(true);
      window.setTimeout(() => setPxeAddressCopied(false), 2_000);
    } catch {
      setError("Could not copy the PXE address. Please copy it manually.");
    }
  }, [recipient]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = walletPickerRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWalletPicker();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [pickerOpen, closeWalletPicker]);

  return {
    path, navigate,
networkId, networkMeta, l1Backend, rpcOverrides, settingsOpen, openSettings, closeSettings,
draftAztecUrl, setDraftAztecUrl, draftL1RpcUrl, setDraftL1RpcUrl, saveSettings, resetSettingsDraft,
setVaultPxeAccount, requireVaultAfterPxeImport, ensureUnlocked, unlockExistingVault, vaultAvailable,
refreshVaultAvailability, secretsVisible, requestUnlock, lockVaultUi,
setShellReady, shellReady, closeWalletPanel,
feeJuiceDetailsOpen, setFeeJuiceDetailsOpen, bridgeConfirmOpen, setBridgeConfirmOpen,
recoveryAcknowledged, setRecoveryAcknowledged, recoveryPromptOpen, setRecoveryPromptOpen,
availableWallets, setAvailableWallets, pickerOpen, setPickerOpen, connectingWallet, setConnectingWallet,
walletConnectError, setWalletConnectError, addressCopied, setAddressCopied, pxeAddressCopied, setPxeAddressCopied,
wcUri, setWcUri, wallet, setWallet, ethSessionOk, setEthSessionOk, dfPxeAccount, setDfPxeAccount,
gateImportingPxe, setGateImportingPxe, gateUnlockingVault, setGateUnlockingVault, gateImportError, setGateImportError,
walletPickerRef, copyResetTimerRef,
recipient, setRecipient, amountFj, setAmountFj, autoClaim, setAutoClaim, l2Secret, setL2Secret, l2Salt, setL2Salt,
l2SigningKey, setL2SigningKey, legacyAccountStyles, setLegacyAccountStyles, showL2Secret, setShowL2Secret,
busy, setBusy, error, setError, ethServiceFeeWei, setEthServiceFeeWei, bridgePhase, setBridgePhase,
progress, setProgress, l1TxHash, setL1TxHash, showBridgeResult, setShowBridgeResult,
credentials, setCredentials, claimJobId, setClaimJobId, claimStatus, setClaimStatus, l2TxHash, setL2TxHash,
feeBalance, setFeeBalance, balanceError, setBalanceError, balanceRefreshing, setBalanceRefreshing,
l2FeeBalance, setL2FeeBalance, l2BalanceError, setL2BalanceError, l2BalanceRefreshing, setL2BalanceRefreshing,
importedAccounts, setImportedAccounts, importedIndex, setImportedIndex, importName, setImportName,
importDragOver, setImportDragOver, credentialsImportError, setCredentialsImportError,
credentialsImportNotice, setCredentialsImportNotice,
recoverySessions, setRecoverySessions, selectedRecoveryHash, setSelectedRecoveryHash,
storageReady, setStorageReady, storageError, setStorageError, selectedSession, refreshSessions,
applyImportedAccount, importPxeFromGate, unlockVaultFromGate, onAccountFile,
refreshFeeBalance, refreshL2FeeBalance, refreshBalancesAfterAction,
connectDetail, onConnectWalletConnect, onConnect, closeWalletPicker, onDisconnect,
copyWalletAddress, copyPxeAddress,
  };
}

export type BridgeSession = ReturnType<typeof useBridgeSession>;
