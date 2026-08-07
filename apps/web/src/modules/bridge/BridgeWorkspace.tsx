import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  type L1BridgeBackend,
  type PendingBridge,
} from "@df-bridge/browser-sdk";
import {
  DEFAULT_NETWORK_ID,
  getNetwork,
  type WebNetworkConfig,
} from "../../config/networks.ts";
import { readAccountFile, type ImportedAztecAccount } from "../../lib/account-import.ts";
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
} from "../../lib/bridge-session.ts";
import { phaseLabel, recoverySteps, selectSessionForUi, shortHash } from "../../lib/claim-recovery.ts";
import {
  amountQuickFill,
  bridgeShortfall,
  formatFjAmount,
  MIN_BRIDGE_FJ,
  parseBridgeAmount,
} from "../../lib/bridge-amount.ts";
import { parseClaimCredentialsFile } from "../../lib/claim-credentials-import.ts";
import {
  downloadClaimCredentials,
  downloadJson,
} from "../../lib/claim-credentials-store.ts";
import {
  advanceProgress,
  bridgePhaseStep,
  claimPhaseStep,
  finishProgress,
  shouldBlockUnload,
  startProgress,
  type ProgressState,
} from "../../lib/progress-track.ts";
import { ProgressPanel } from "../../components/ui/ProgressPanel.tsx";
import {
  hasRpcOverrides,
} from "../../lib/rpc-overrides.ts";
import { NetworkIntegrityPanel } from "../network/NetworkIntegrityPanel.tsx";
import { TxAnalysisLinks } from "../../components/ui/TxAnalysisLinks.tsx";
import { ActionHintButton } from "../../components/ui/ActionHintButton.tsx";
import { formatDappError, logDappError, pushDappLog } from "../../lib/dapp-log.ts";
import { importDfPunkFileIntoPxe } from "../../lib/df-pxe-import.ts";
import { saveAztecWallet } from "../../lib/aztec-wallet-store.ts";
import {
  AZTEC_MAINNET_NODE_PUBLIC,
  OFFICIAL_DOCS_FEE_JUICE,
} from "../../lib/official-links.ts";
import {
  isSponsoredFpcAddress,
} from "../../lib/sponsored-fpc.ts";
import {
  assertBridgeReadyDfPxeAccount,
  isBridgeReadyDfPxeAccount,
} from "../../lib/df-pxe-bridge-guard.ts";
import {
  isTrustedConnector,
  validateConnectedWalletSession,
} from "../../lib/wallet-session-guard.ts";
import { LEGACY_WALLET_RDNS } from "@df-bridge/browser-sdk";
import { usePath, useNavigate } from "../../app/router.tsx";
import { ROUTES } from "../../app/routes.ts";
import { useNetwork } from "../../providers/NetworkProvider.tsx";
import { useVault } from "../../providers/VaultProvider.tsx";
import { useUi } from "../../providers/UiProvider.tsx";
import { TopBar } from "../../components/layout/TopBar.tsx";
import { WalletDrawer } from "../../components/wallet/WalletDrawer.tsx";
import { VaultPage } from "../vault/VaultPage.tsx";
import { VaultLockedError } from "../../lib/vault.ts";
import { ConnectSessionGate } from "../../components/ui/ConnectSessionGate.tsx";
import { AztecRpcOptionsField } from "../../components/ui/AztecRpcOptionsField.tsx";

type NetworkMeta = WebNetworkConfig;

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";
/** Anonymous Trezor / treasury — 5% AZTEC + mainnet ETH service fee. */
const BRIDGE_FEE_RECIPIENT = (import.meta.env.VITE_BRIDGE_FEE_RECIPIENT as string | undefined)?.trim() ?? "";
/** Optional fixed mainnet ETH service fee (wei). Empty = estimate from gas × ~1 L1 tx. */
const BRIDGE_ETH_FEE_WEI_OVERRIDE = parseEthFeeWeiOverride(
  (import.meta.env.VITE_BRIDGE_ETH_FEE_WEI as string | undefined) ?? "",
);
const BRIDGE_PUBLIC_URL =
  (import.meta.env.VITE_BRIDGE_PUBLIC_URL as string | undefined)?.trim() ||
  "https://df-atlas.onchainreality.xyz/";
const DFPUNK_PLAY_URL =
  (import.meta.env.VITE_DFPUNK_PLAY_URL as string | undefined)?.trim() ||
  "https://aztec.dfpunk.xyz/play/";
/** Build-time: include / use in-browser PXE claim (heavy chunk). */
const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM !== "false";

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response (HTTP ${response.status}).`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON (HTTP ${response.status}).`);
  }
}

function storageErrorMessage(e: unknown): string {
  if (e instanceof BridgeStorageError) return e.message;
  if (e instanceof VaultLockedError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

async function loadInitialSession(networkId: string): Promise<BridgeSessionEntry | null> {
  try {
    return (await getActiveSession(networkId)) ?? (await listIncompleteSessions(networkId))[0] ?? null;
  } catch {
    return null;
  }
}

async function loadInitialSessions(networkId: string): Promise<BridgeSessionEntry[]> {
  try {
    return await listIncompleteSessions(networkId);
  } catch {
    return [];
  }
}

export function BridgeWorkspace() {
  const path = usePath();
  const navigate = useNavigate();
  const networkApi = useNetwork();
  const {
    networks,
    networkId,
    setNetworkId,
    networkMeta,
    l1Backend,
    setL1Backend,
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
    secretsVisible,
    requestUnlock,
    lock: lockVaultUi,
  } = useVault();
  const { setShellReady, shellReady } = useUi();

  const [feeJuiceDetailsOpen, setFeeJuiceDetailsOpen] = useState(false);
  const [bridgeConfirmOpen, setBridgeConfirmOpen] = useState(false);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoveryPromptOpen, setRecoveryPromptOpen] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletConnectError, setWalletConnectError] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [ethSessionOk, setEthSessionOk] = useState(false);
  const [dfPxeAccount, setDfPxeAccount] = useState<ImportedAztecAccount | null>(null);
  const [gateImportingPxe, setGateImportingPxe] = useState(false);
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
      applyImportedAccount,
    ],
  );

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
        setFeeBalance(null);
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
        setL2FeeBalance(null);
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

  // On mount (once networkMeta is ready): resume every saved session that is
  // still waiting on L1 confirmation or L2 claim confirmation. Only the
  // session that was active when the page loaded also drives the top-level
  // Bridge tab UI (bridgePhase / credentials / l1TxHash); the rest are
  // updated silently in storage and show up in the Recover tab list.
  useEffect(() => {
    if (!networkMeta) return;
    let cancelled = false;

    void (async () => {
      const sessions = await refreshSessions();
      if (cancelled) return;
      const activeKey = selectedRecoveryHash
        ? normalizeL1TxHash(selectedRecoveryHash)
        : sessions[0]
          ? normalizeL1TxHash(sessions[0].l1TxHash)
          : null;

      await Promise.all(
        sessions.map(async (session) => {
          const key = normalizeL1TxHash(session.l1TxHash);
          const isActiveFlow = activeKey === key;

          if (session.phase === "l1-pending" && session.pending) {
            if (isActiveFlow) {
              setBusy(true);
              setError(null);
              setBridgePhase("Recovering pending L1 bridge from this browser…");
              setProgress(startProgress("resume-l1", "receipt"));
            }
            try {
              const result = await resumePendingBridge({
                pending: {
                  ...session.pending,
                  portal:
                    session.pending.portal ?? networkMeta.l1Addresses.feeJuicePortal,
                },
                chainId: networkMeta.l1ChainId,
                l1RpcUrl: networkMeta.l1RpcUrl,
              });
              if (cancelled) return;
              await upsertSession(networkId, {
                l1TxHash: result.l1TxHash,
              phase: "ready-to-claim",
              recipient: result.credentials.recipient,
              claimAmount: result.credentials.claimAmount,
              credentials: result.credentials,
              makeActive: false,
            });
            downloadClaimCredentials(result.credentials.recipient, result.credentials, {
              l1TxHash: result.l1TxHash,
              networkId,
            });
            if (isActiveFlow) {
              setL1TxHash(result.l1TxHash);
              setCredentials(result.credentials);
              setBridgePhase("L1 bridge recovered — claim credentials restored");
              setProgress((prev) => finishProgress(prev, "succeeded"));
            }
          } catch (cause: unknown) {
            if (cancelled) return;
            if (isActiveFlow) {
              setError(
                `Could not recover the pending bridge: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              );
              setBridgePhase("Pending bridge recovery failed — saved recovery data was kept");
              setProgress((prev) => finishProgress(prev, "failed"));
            }
          } finally {
            if (!cancelled && isActiveFlow) setBusy(false);
          }
          return;
        }

        if (session.phase === "claim-sent" && session.l2TxHash) {
          if (isActiveFlow) {
            setBridgePhase(`Waiting for L2 confirmation ${shortHash(session.l2TxHash)}…`);
            setProgress({ ...startProgress("wait-l2", "confirm"), txSubmitted: true });
          }
          try {
            const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
            const { waitForL2ClaimTx } = await loadBrowserClaim();
            await waitForL2ClaimTx({
              aztecNodeUrl: networkMeta.aztecNodeUrl,
              l2TxHash: session.l2TxHash,
            });
            if (cancelled) return;
            await removeSession(networkId, session.l1TxHash);
            if (isActiveFlow) {
              setL2TxHash(session.l2TxHash);
              setClaimStatus("succeeded");
              setBridgePhase(`L2 claim complete — ${session.l2TxHash}`);
              setProgress((prev) => finishProgress(prev, "succeeded"));
              setRecoveryPromptOpen(false);
              refreshBalancesAfterAction();
            }
          } catch (cause: unknown) {
            if (cancelled) return;
            const message = cause instanceof Error ? cause.message : String(cause);
            let recoveryError: string | null = null;
            try {
              await upsertSession(networkId, {
                l1TxHash: session.l1TxHash,
                phase: "claim-sent",
                recipient: session.recipient,
                claimAmount: session.claimAmount,
                credentials: session.credentials,
                l2TxHash: session.l2TxHash,
                lastError: message,
                makeActive: false,
              });
            } catch (storageError: unknown) {
              recoveryError = storageErrorMessage(storageError);
            }
            if (isActiveFlow) {
              setError(
                recoveryError
                  ? `${message} Recovery status could not be updated: ${recoveryError}`
                  : message,
              );
              setProgress((prev) => finishProgress(prev, "failed"));
            }
          }
        }
      }),
      );
      if (!cancelled) await refreshSessions();
    })();

    return () => {
      cancelled = true;
    };
  }, [networkMeta, networkId, selectedRecoveryHash, refreshSessions, refreshBalancesAfterAction]);

  const startClaimJob = useCallback(
    async (l1Hash: string, creds: ClaimCredentials, secret: string, salt?: string, signingKey?: string) => {
      if (BROWSER_CLAIM) {
        if (!networkMeta?.aztecNodeUrl) {
          throw new Error("Network meta missing aztecNodeUrl for browser claim.");
        }
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { waitAndClaimInBrowser, getClaimMessageStatus } = await loadBrowserClaim();

        setClaimJobId("browser");
        setClaimStatus("running");
        setL2TxHash(null);
        setBridgePhase("Checking claim message status…");
        setProgress(startProgress("claim", "status"));

        const status = await getClaimMessageStatus({
          aztecNodeUrl: networkMeta.aztecNodeUrl,
          credentials: creds,
        });
        if (status === "consumed") {
          await removeSession(networkId, l1Hash);
          await refreshSessions();
          setClaimStatus("succeeded");
          setBridgePhase("Claim message already consumed — nothing to do");
          setProgress((prev) => finishProgress(prev, "succeeded"));
          setRecoveryPromptOpen(false);
          return;
        }

        setBridgePhase("Loading browser PXE (first time may download a large chunk)…");
        setProgress((prev) => advanceProgress(prev, { track: "claim", stepKey: "pxe" }));
        await upsertSession(networkId, {
          l1TxHash: l1Hash,
          phase: "claiming",
          recipient: creds.recipient,
          claimAmount: creds.claimAmount,
          credentials: creds,
          makeActive: false,
        });
        await refreshSessions();

        let submittedHash: string | null = null;
        try {
          const { l2TxHash: hash } = await waitAndClaimInBrowser({
            aztecNodeUrl: networkMeta.aztecNodeUrl,
            networkId: networkMeta.id,
            credentials: creds,
            l2SecretKey: secret,
            salt,
            signingKey: signingKey?.trim() || undefined,
            onProgress: (phase, detail) => {
              setClaimStatus(phase);
              setBridgePhase(detail ?? null);
              setProgress((prev) =>
                advanceProgress(prev, { track: "claim", stepKey: claimPhaseStep(phase) }),
              );
            },
            onTxSent: async (l2Hash) => {
              submittedHash = l2Hash;
              setL2TxHash(l2Hash);
              setProgress((prev) =>
                advanceProgress(prev, {
                  track: "claim",
                  stepKey: "confirm",
                  txSubmitted: true,
                }),
              );
              try {
                await upsertSession(networkId, {
                  l1TxHash: l1Hash,
                  phase: "claim-sent",
                  recipient: creds.recipient,
                  claimAmount: creds.claimAmount,
                  credentials: creds,
                  l2TxHash: l2Hash,
                  makeActive: false,
                });
                await refreshSessions();
              } catch (storageError: unknown) {
                downloadJson(`claim-sent-${shortHash(l1Hash)}.json`, {
                  networkId,
                  l1TxHash: l1Hash,
                  l2TxHash: l2Hash,
                  credentials: creds,
                });
                setError(
                  `L2 claim submitted, but browser recovery storage failed: ${storageErrorMessage(
                    storageError,
                  )}. A backup JSON was downloaded.`,
                );
              }
            },
          });

          if (!hash) {
            // Message was consumed mid-flight (e.g. claimed elsewhere) — nothing left to do.
            await removeSession(networkId, l1Hash);
            await refreshSessions();
            setClaimStatus("succeeded");
            setBridgePhase("Claim message already consumed — nothing to do");
            setProgress((prev) => finishProgress(prev, "succeeded"));
            setRecoveryPromptOpen(false);
            return;
          }

          setL2TxHash(hash);
          setClaimStatus("succeeded");
          setBridgePhase(`L2 claim complete — ${hash}`);
          setProgress((prev) => finishProgress(prev, "succeeded"));
          setRecoveryPromptOpen(false);
          await removeSession(networkId, l1Hash);
          await refreshSessions();
          refreshBalancesAfterAction();
          return;
        } catch (claimError: unknown) {
          const message = claimError instanceof Error ? claimError.message : String(claimError);
          setProgress((prev) => finishProgress(prev, "failed"));
          try {
            await upsertSession(networkId, {
              l1TxHash: l1Hash,
              phase: submittedHash ? "claim-sent" : "failed",
              recipient: creds.recipient,
              claimAmount: creds.claimAmount,
              credentials: creds,
              ...(submittedHash ? { l2TxHash: submittedHash } : {}),
              lastError: message,
              makeActive: false,
            });
            await refreshSessions();
          } catch (storageError: unknown) {
            if (submittedHash) {
              downloadJson(`claim-sent-${shortHash(l1Hash)}.json`, {
                networkId,
                l1TxHash: l1Hash,
                l2TxHash: submittedHash,
                credentials: creds,
                error: message,
              });
            }
            setError(
              `Claim recovery storage failed: ${storageErrorMessage(storageError)}${
                submittedHash ? ". A backup JSON was downloaded." : ""
              }`,
            );
          }
          throw claimError;
        }
      }

      // Server-side claim: nothing runs in this tab, so the step panel would be
      // misleading — the polling status line covers it instead.
      setProgress(null);
      const res = await fetch(`${API_BASE}/v1/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: networkId,
          credentials: creds,
          callerAddress: creds.recipient,
          l2SecretKey: secret,
          ...(salt?.trim() ? { salt: salt.trim() } : {}),
          ...(signingKey?.trim() ? { signingKey: signingKey.trim() } : {}),
        }),
      });
      const body = await readJsonResponse<{ jobId?: string; error?: string }>(
        res,
        "Claim API",
      );
      if (!res.ok) throw new Error(body.error ?? "Claim request failed");
      setClaimJobId(body.jobId ?? null);
      setClaimStatus("queued");
      setL2TxHash(null);
      await upsertSession(networkId, {
        l1TxHash: l1Hash,
        phase: "claiming",
        recipient: creds.recipient,
        claimAmount: creds.claimAmount,
        credentials: creds,
        claimJobId: body.jobId,
        claimChannel: "api",
        makeActive: false,
      });
      await refreshSessions();
    },
    [networkId, networkMeta, refreshSessions, refreshBalancesAfterAction],
  );

  const onBridge = useCallback(async () => {
    if (!wallet || !networkMeta) return;
    try {
      const live = await validateConnectedWalletSession(wallet);
      setWallet(live);
      const pxe = assertBridgeReadyDfPxeAccount(dfPxeAccount, live.address);
      if (recipient.trim().toLowerCase() !== pxe.address.toLowerCase()) {
        throw new Error("Recipient must match the DF Punk PXE account (anti-inject lock).");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (autoClaim && !l2Secret.trim()) {
      setError("Auto-claim is on — enter the Aztec L2 secret for that recipient account.");
      return;
    }
    const amount = parseBridgeAmount(amountFj);
    if (amount.wei === null) {
      setError(amount.error ?? `Minimum bridge amount is ${MIN_BRIDGE_FJ} FJ.`);
      return;
    }

    setBusy(true);
    setBridgePhase(null);
    setError(null);
    setL1TxHash(null);
    setCredentials(null);
    setShowBridgeResult(false);
    setClaimJobId(null);
    setClaimStatus(null);
    setL2TxHash(null);
    setProgress(startProgress("bridge", "prepare"));
    try {
      let provider = wallet.provider;
      let chainId = wallet.chainId;
      if (chainId !== networkMeta.l1ChainId) {
        setBridgePhase("Switch wallet to the selected L1 network…");
        await switchWalletChain(provider, networkMeta.l1ChainId);
        const refreshed = await connectEvmWalletDetail({
          info: {
            uuid: wallet.rdns ?? "connected",
            name: wallet.name ?? "Wallet",
            icon: "",
            rdns: wallet.rdns ?? "connected",
          },
          provider,
        });
        setWallet(refreshed);
        provider = refreshed.provider;
        chainId = refreshed.chainId;
      }

      const mint = networkMeta.l1Addresses.feeAssetHandler !== null;
      const backend = l1Backend;
      if (!BRIDGE_FEE_RECIPIENT || !/^0x[0-9a-fA-F]{40}$/.test(BRIDGE_FEE_RECIPIENT)) {
        throw new Error(
          "Set VITE_BRIDGE_FEE_RECIPIENT=0x… (your anonymous Trezor) in .env / Netlify env.",
        );
      }
      if (isSponsoredFpcAddress(recipient) && autoClaim) {
        throw new Error(
          "Sponsored FPC is a contract — turn off auto-claim. Bridge Fee Juice to the FPC address only.",
        );
      }
      const result = await bridgeFromConnectedWallet({
        provider,
        chainId,
        expectedChainId: networkMeta.l1ChainId,
        addresses: networkMeta.l1Addresses,
        aztecRecipient: recipient.trim(),
        amount: amount.wei,
        mint,
        backend,
        l1RpcUrl: networkMeta.l1RpcUrl,
        feeRecipient: BRIDGE_FEE_RECIPIENT as Hex,
        ethServiceFeeWei: BRIDGE_ETH_FEE_WEI_OVERRIDE ?? ethServiceFeeWei ?? undefined,
        onPending: async (pending: PendingBridge) => {
          setL1TxHash(pending.l1TxHash);
          setShowBridgeResult(true);
          try {
            await upsertSession(networkId, {
              l1TxHash: pending.l1TxHash,
              phase: "l1-pending",
              recipient: pending.recipient,
              claimAmount: pending.claimAmount,
              pending,
            });
            await refreshSessions();
          } catch (storageError: unknown) {
            downloadJson(`claim-pending-${shortHash(pending.l1TxHash)}.json`, {
              version: 1,
              networkId,
              pending,
            });
            setError(
              `L1 deposit submitted, but browser recovery storage failed: ${storageErrorMessage(
                storageError,
              )}. Keep the downloaded pending-claim backup.`,
            );
          }
        },
        onProgress: (phase: BridgeProgressPhase, detail?: string) => {
          const labels: Record<BridgeProgressPhase, string> = {
            prepare: "Preparing…",
            eth_fee_wallet: "Confirm batched L1 bridge (ETH fee + fees + deposit) in wallet…",
            eth_fee_wait: "ETH service fee submitted — waiting…",
            check_allowance: "Checking token allowance…",
            approve_wallet: "Confirm approve in wallet…",
            approve_wait: "Approve submitted — waiting for confirmation…",
            mint_wallet: "Confirm faucet mint in wallet…",
            mint_wait: "Mint submitted — waiting for confirmation…",
            bridge_wallet:
              backend === "portal"
                ? "Confirm batched portal bridge (or deposit) in wallet…"
                : mint
                  ? "Confirm mintAndBridge in wallet…"
                  : "Approve done — confirm GoBridge tx in wallet…",
            bridge_wait: "Bridge submitted — waiting for confirmation…",
            parse_receipt: "Parsing L1 deposit event…",
          };
          setBridgePhase(detail ? `${labels[phase]} ${detail}` : labels[phase]);
          setProgress((prev) =>
            advanceProgress(prev, { track: "bridge", stepKey: bridgePhaseStep(phase) }),
          );
        },
      });
      setL1TxHash(result.l1TxHash);
      setCredentials(result.credentials);
      setBridgePhase("L1 bridge complete — credentials saved locally and downloaded");
      setProgress((prev) => advanceProgress(prev, { track: "bridge", stepKey: "saved" }));

      const backupErrors: string[] = [];
      try {
        await upsertSession(networkId, {
          l1TxHash: result.l1TxHash,
          phase: "ready-to-claim",
          recipient: result.credentials.recipient,
          claimAmount: result.credentials.claimAmount,
          credentials: result.credentials,
        });
        await refreshSessions();
      } catch (storageError: unknown) {
        backupErrors.push(
          `credentials could not be saved in this browser: ${storageErrorMessage(storageError)}`,
        );
      }

      try {
        downloadClaimCredentials(result.credentials.recipient, result.credentials, {
          l1TxHash: result.l1TxHash,
          networkId,
        });
      } catch (downloadError: unknown) {
        backupErrors.push(
          `credentials JSON could not be downloaded: ${storageErrorMessage(downloadError)}`,
        );
      }

      if (backupErrors.length > 0) {
        setError(`L1 bridge completed, but ${backupErrors.join("; ")}`);
      }

      refreshBalancesAfterAction();

      if (autoClaim) {
        setBridgePhase("Starting L2 claim…");
        await startClaimJob(result.l1TxHash, result.credentials, l2Secret.trim(), l2Salt, l2SigningKey);
        // Browser claim already set the final phase / L2 tx; API claim stays "queued".
        if (!BROWSER_CLAIM) {
          setBridgePhase("L2 claim job queued — polling status…");
        }
      } else {
        setProgress((prev) => finishProgress(prev, "succeeded"));
      }
    } catch (e: unknown) {
      setError(formatWalletError(e));
      setBridgePhase(null);
      setProgress((prev) => finishProgress(prev, "failed"));
    } finally {
      setBusy(false);
    }
  }, [
    wallet,
    networkMeta,
    recipient,
    amountFj,
    autoClaim,
    l2Secret,
    l2Salt,
    l2SigningKey,
    l1Backend,
    startClaimJob,
    networkId,
    refreshSessions,
    refreshBalancesAfterAction,
    dfPxeAccount,
  ]);

  const selectRecoverySession = useCallback(
    async (session: BridgeSessionEntry) => {
      setSelectedRecoveryHash(session.l1TxHash);
      try {
        await setActiveSession(networkId, session.l1TxHash);
      } catch {
        /* vault may be locked — still select in UI */
      }
      setL1TxHash(session.l1TxHash);
      setCredentials(session.credentials ?? null);
      setClaimJobId(session.claimJobId ?? null);
      setClaimStatus(null);
      setL2TxHash(session.l2TxHash ?? null);
      setError(null);
      // The guide card below already headlines the phase — no bottom status line.
      setBridgePhase(null);
      setProgress(null);
      setRecoveryPromptOpen(false);
      setImportedAccounts([]);
      setImportName(null);
      setImportedIndex(0);
      setRecipient("");
      setL2Secret("");
      setL2Salt("");
      setL2SigningKey("");
    },
    [networkId],
  );

  const onClaimCredentialsFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setCredentialsImportError(null);
      setCredentialsImportNotice(null);
      try {
        const parsed = parseClaimCredentialsFile(JSON.parse(await file.text()) as unknown);
        if (parsed.networkId && parsed.networkId !== networkId) {
          throw new Error(
            `These credentials are for network "${parsed.networkId}", but you are on "${networkId}".`,
          );
        }

        const sessions = await listIncompleteSessions(networkId);
        const duplicate = sessions.find(
          (session) => normalizeL1TxHash(session.l1TxHash) === parsed.l1TxHash,
        );
        if (duplicate) {
          await selectRecoverySession(duplicate);
          setCredentialsImportNotice(
            `Already in the list — L1 ${shortHash(duplicate.l1TxHash)} is ${phaseLabel(
              duplicate.phase,
            ).toLowerCase()}. Selected it below instead of adding a copy.`,
          );
          return;
        }

        const entry = await upsertSession(networkId, {
          l1TxHash: parsed.l1TxHash,
          phase: "ready-to-claim",
          recipient: parsed.recipient,
          claimAmount: parsed.credentials.claimAmount,
          credentials: parsed.credentials,
        });
        await refreshSessions();
        selectRecoverySession(entry);
        setCredentialsImportNotice(
          `Imported L1 ${shortHash(entry.l1TxHash)} — follow the steps below to finish the claim.`,
        );
      } catch (e: unknown) {
        setCredentialsImportError(e instanceof Error ? e.message : String(e));
      }
    },
    [networkId, refreshSessions, selectRecoverySession],
  );

  const retryResumeL1 = useCallback(
    async (session: BridgeSessionEntry) => {
      if (!networkMeta || !session.pending) return;
      setBusy(true);
      setError(null);
      setBridgePhase(`Resuming L1 bridge ${shortHash(session.l1TxHash)}…`);
      setProgress(startProgress("resume-l1", "receipt"));
      try {
        const result = await resumePendingBridge({
          pending: {
            ...session.pending,
            portal: session.pending.portal ?? networkMeta.l1Addresses.feeJuicePortal,
          },
          chainId: networkMeta.l1ChainId,
          l1RpcUrl: networkMeta.l1RpcUrl,
        });
        setProgress((prev) =>
          advanceProgress(prev, { track: "resume-l1", stepKey: "credentials" }),
        );
        await upsertSession(networkId, {
          l1TxHash: result.l1TxHash,
          phase: "ready-to-claim",
          recipient: result.credentials.recipient,
          claimAmount: result.credentials.claimAmount,
          credentials: result.credentials,
          makeActive: false,
        });
        downloadClaimCredentials(result.credentials.recipient, result.credentials, {
          l1TxHash: result.l1TxHash,
          networkId,
        });
        await refreshSessions();
        if (normalizeL1TxHash(session.l1TxHash) === normalizeL1TxHash(selectedRecoveryHash ?? "")) {
          setCredentials(result.credentials);
          setL1TxHash(result.l1TxHash);
        }
        setBridgePhase("L1 bridge recovered — claim credentials restored");
        setProgress((prev) => finishProgress(prev, "succeeded"));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setBridgePhase("Pending bridge recovery failed — saved recovery data was kept");
        setProgress((prev) => finishProgress(prev, "failed"));
      } finally {
        setBusy(false);
      }
    },
    [networkMeta, networkId, refreshSessions, selectedRecoveryHash],
  );

  const waitForSessionL2 = useCallback(
    async (session: BridgeSessionEntry) => {
      if (!networkMeta || !session.l2TxHash) return;
      setBusy(true);
      setError(null);
      setBridgePhase(`Waiting for L2 confirmation ${shortHash(session.l2TxHash)}…`);
      setProgress({ ...startProgress("wait-l2", "confirm"), txSubmitted: true });
      try {
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { waitForL2ClaimTx } = await loadBrowserClaim();
        await waitForL2ClaimTx({
          aztecNodeUrl: networkMeta.aztecNodeUrl,
          l2TxHash: session.l2TxHash,
        });
        await removeSession(networkId, session.l1TxHash);
        await refreshSessions();
        setBridgePhase(`L2 claim complete — ${session.l2TxHash}`);
        setProgress((prev) => finishProgress(prev, "succeeded"));
        setClaimStatus("succeeded");
        setL2TxHash(session.l2TxHash);
        refreshBalancesAfterAction();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setProgress((prev) => finishProgress(prev, "failed"));
        try {
          await upsertSession(networkId, {
            l1TxHash: session.l1TxHash,
            phase: "claim-sent",
            recipient: session.recipient,
            claimAmount: session.claimAmount,
            credentials: session.credentials,
            l2TxHash: session.l2TxHash,
            lastError: message,
            makeActive: false,
          });
          await refreshSessions();
          setError(message);
        } catch (storageError: unknown) {
          setError(
            `${message} Recovery status could not be updated: ${storageErrorMessage(storageError)}`,
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [networkMeta, networkId, refreshSessions, refreshBalancesAfterAction],
  );

  const onResumeClaim = useCallback(
    async (session: BridgeSessionEntry) => {
      if (!session.credentials) return;
      if (!l2Secret.trim()) {
        setError("Enter the Aztec L2 secret to claim.");
        return;
      }
      setL1TxHash(session.l1TxHash);
      setCredentials(session.credentials);
      setBusy(true);
      setError(null);
      try {
        await startClaimJob(
          session.l1TxHash,
          session.credentials,
          l2Secret.trim(),
          l2Salt,
          l2SigningKey,
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        await refreshSessions();
      }
    },
    [l2Secret, l2Salt, l2SigningKey, startClaimJob, refreshSessions],
  );

  const onRemoveSession = useCallback(
    async (session: BridgeSessionEntry) => {
      await removeSession(networkId, session.l1TxHash);
      const remaining = await refreshSessions();
      const wasSelected =
        selectedSession &&
        normalizeL1TxHash(selectedSession.l1TxHash) === normalizeL1TxHash(session.l1TxHash);
      if (wasSelected) {
        const next = remaining[0] ?? null;
        setSelectedRecoveryHash(next?.l1TxHash ?? null);
        if (next) {
          await selectRecoverySession(next);
        } else {
          setCredentials(null);
          setL1TxHash(null);
          setBridgePhase(null);
          setProgress(null);
        }
      }
    },
    [networkId, refreshSessions, selectedSession, selectRecoverySession],
  );

  useEffect(() => {
    if (!claimJobId || claimJobId === "browser" || !l1TxHash) return;
    const currentL1Hash = l1TxHash;
    const t = setInterval(() => {
      void fetch(`${API_BASE}/v1/jobs/${claimJobId}`)
        .then((response) =>
          readJsonResponse<{
            status: string;
            error?: string;
            result?: { l2TxHash?: string };
          }>(response, "Claim status API"),
        )
        .then(async (job: { status: string; error?: string; result?: { l2TxHash?: string } }) => {
          setClaimStatus(job.status);
          if (job.status === "failed") {
            setError(job.error ?? "Claim failed");
            if (credentials) {
              await upsertSession(networkId, {
                l1TxHash: currentL1Hash,
                phase: "failed",
                recipient: credentials.recipient,
                claimAmount: credentials.claimAmount,
                credentials,
                lastError: job.error ?? "Claim failed",
                makeActive: false,
              });
              await refreshSessions();
            }
            clearInterval(t);
          }
          if (job.status === "succeeded") {
            if (job.result?.l2TxHash) setL2TxHash(job.result.l2TxHash);
            setRecoveryPromptOpen(false);
            await removeSession(networkId, currentL1Hash);
            await refreshSessions();
            clearInterval(t);
          }
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          clearInterval(t);
        });
    }, 3000);
    return () => clearInterval(t);
  }, [claimJobId, l1TxHash, credentials, networkId, refreshSessions]);

  // Native guard on top of the on-screen warning: reloading mid-proof throws
  // away minutes of work (credentials stay saved, so funds are never at risk).
  const blockUnload = shouldBlockUnload(progress);
  useEffect(() => {
    if (!blockUnload) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [blockUnload]);

  const lastLoggedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      lastLoggedErrorRef.current = null;
      return;
    }
    if (lastLoggedErrorRef.current === error) return;
    lastLoggedErrorRef.current = error;
    const formatted = formatDappError(error);
    pushDappLog({
      kind: "error",
      title: formatted.title,
      detail: formatted.detail,
    });
  }, [error]);

  const lastL1LogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!l1TxHash || lastL1LogRef.current === l1TxHash) return;
    lastL1LogRef.current = l1TxHash;
    pushDappLog({
      kind: "tx",
      title: "L1 bridge submitted",
      detail: l1TxHash,
    });
  }, [l1TxHash]);

  const lastL2LogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!l2TxHash || lastL2LogRef.current === l2TxHash) return;
    lastL2LogRef.current = l2TxHash;
    pushDappLog({
      kind: "tx",
      title: "L2 claim confirmed",
      detail: l2TxHash,
    });
  }, [l2TxHash]);

  const lastPhaseLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bridgePhase || busy) return;
    if (lastPhaseLogRef.current === bridgePhase) return;
    lastPhaseLogRef.current = bridgePhase;
    pushDappLog({ kind: "info", title: bridgePhase, ttlMs: 8_000 });
  }, [bridgePhase, busy]);

  const amountCheck = parseBridgeAmount(amountFj);
  const feeSplit =
    amountCheck.wei !== null ? computeBridgeFee(amountCheck.wei) : null;
  // Networks with a fee asset handler mint whatever the deposit needs, so a low
  // wallet balance is not a blocker there.
  const canMintFeeJuice = !!networkMeta?.l1Addresses.feeAssetHandler;
  const shortfall =
    amountCheck.wei !== null && feeBalance && !canMintFeeJuice
      ? bridgeShortfall(amountCheck.wei, feeBalance.balance)
      : null;

  const fundingSponsoredFpc = isSponsoredFpcAddress(recipient);
  const dfPxeReady =
    ethSessionOk &&
    isTrustedConnector(wallet) &&
    isBridgeReadyDfPxeAccount(dfPxeAccount, wallet?.address) &&
    recipient.trim().toLowerCase() === dfPxeAccount.address.toLowerCase() &&
    !fundingSponsoredFpc;

  useEffect(() => {
    setShellReady(dfPxeReady);
    if (dfPxeReady) {
      pushDappLog({
        kind: "announce",
        title: "Session unlocked",
        detail: "Web3 connector + DF Punk PXE ready — menus and bridge tools are available.",
        ttlMs: 12_000,
      });
    }
    return () => setShellReady(false);
  }, [dfPxeReady, setShellReady]);

  const canBridge =
    dfPxeReady &&
    !!networkMeta &&
    !amountCheck.error &&
    !shortfall &&
    !!BRIDGE_FEE_RECIPIENT &&
    (!autoClaim || !!l2Secret.trim());
  const bridgeButtonLabel = !wallet
    ? "Connect wallet first"
    : !ethSessionOk
      ? "Validate connector session"
      : !dfPxeAccount
        ? "Import DF Punk → PXE first"
        : shortfall
          ? `Insufficient ${feeBalance?.symbol ?? "AZTEC"}`
          : amountCheck.error
            ? amountCheck.error
            : !BRIDGE_FEE_RECIPIENT
              ? "Bridge fee recipient not configured"
              : autoClaim && !l2Secret.trim()
                ? "Enter DF Punk L2 secret for auto-claim"
                : autoClaim
                  ? "Bridge + claim (DF Punk PXE)"
                  : "Bridge via wallet (DF Punk PXE)";
  const recoveryAccountReady =
    !!selectedSession?.credentials &&
    !!l2Secret.trim() &&
    recipient.trim().toLowerCase() === selectedSession.credentials.recipient.toLowerCase();

  const amountQuickAction = feeBalance
    ? amountQuickFill(feeBalance.balance, canMintFeeJuice)
    : null;

  const applyAmountQuickFill = () => {
    if (!amountQuickAction) return;
    setAmountFj(amountQuickAction.amountFj);
    setError(null);
  };

  const requestBridge = () => {
    if (!dfPxeReady) {
      setError(
        "Bridge is locked until MetaMask/WalletConnect is validated and a DF Punk account is imported into PXE.",
      );
      return;
    }
    if (amountCheck.error) {
      setError(amountCheck.error);
      return;
    }
    if (shortfall) {
      setError(`Insufficient ${feeBalance?.symbol ?? "AZTEC"} balance.`);
      return;
    }
    if (autoClaim && !l2Secret.trim()) {
      setError("Auto-claim is on — DF Punk account secret missing.");
      return;
    }
    setError(null);
    setRecoveryAcknowledged(false);
    void (async () => {
      try {
        const ok = await ensureUnlocked("secrets");
        if (!ok) {
          setStorageError("Unlock the vault to save recovery sessions.");
          setStorageReady(false);
          return;
        }
        await assertBridgeStorageReady();
        setStorageReady(true);
        setStorageError(null);
        setBridgeConfirmOpen(true);
      } catch (e: unknown) {
        setStorageReady(false);
        setStorageError(storageErrorMessage(e));
      }
    })();
  };

  const renderAccountImportCard = (opts: {
    id?: string;
    highlight?: boolean;
    title?: string;
    hint?: ReactNode;
    onFile: (file: File | null) => void;
    onSelectAccount: (index: number) => void;
  }) => (
    <div
      id={opts.id ?? "aztec-account-import"}
      className={`card account-import${opts.highlight ? " recovery-active" : ""}`}
    >
      <strong>{opts.title ?? "Import Aztec account"}</strong>
      <p className="hint">
        {opts.hint ?? (
          <>
            Upload <span className="mono">dfpunk-account-*.json</span> or{" "}
            <span className="mono">.txt</span> backup with{" "}
            <span className="mono">address / secretKey / salt / signingKey</span>. Fills the form
            below (signingKey is required for dfpunk accounts).             Prefer <strong>Wallets</strong> (top right) → Import from DF client → PXE for bridge.
          </>
        )}
      </p>
      <div
        className={`dropzone${importDragOver ? " drag-over" : ""}${busy ? " disabled" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setImportDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setImportDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget === e.target) setImportDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setImportDragOver(false);
          if (busy) return;
          const f = e.dataTransfer.files?.[0] ?? null;
          void opts.onFile(f);
        }}
      >
        <p className="dropzone-title">
          {importDragOver ? "Release to upload" : "Drag & drop JSON or .txt backup"}
        </p>
        <p className="hint">or click to choose a file</p>
        <label className="file-label">
          <span className="sr-only">Choose JSON file</span>
          <input
            type="file"
            accept="application/json,.json,.txt,text/plain"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void opts.onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {importName ? (
        <p className="hint">
          Loaded <span className="mono">{importName}</span>
          {importedAccounts.length > 1 ? ` (${importedAccounts.length} accounts)` : ""}
        </p>
      ) : null}
      {importedAccounts.length > 1 ? (
        <label>
          Account in file
          <select
            value={importedIndex}
            disabled={busy}
            onChange={(e) => {
              const i = Number(e.target.value);
              opts.onSelectAccount(i);
            }}
          >
            {importedAccounts.map((a, i) => (
              <option key={`${a.address}-${i}`} value={i}>
                #{i + 1} {a.address.slice(0, 10)}…{a.address.slice(-6)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );

  const renderClaimKeyFields = () => {
    if (dfPxeAccount && !secretsVisible) {
      return (
        <div className="card claim-opts">
          <p className="hint">
            PXE wallet secrets are hidden until the vault unlocks (password + signingKey).
          </p>
          <button type="button" className="primary" onClick={requestUnlock}>
            Unlock vault
          </button>
        </div>
      );
    }
    return (
    <div className="card claim-opts">
      <p className="hint">
        {BROWSER_CLAIM
          ? "Account keys are used only in memory for the browser claim and are not persisted."
          : "Secret is only used server-side for wait + claim. Prefer CLI claim if you do not want to paste it into the browser."}
      </p>
      <label>
        L2 secret
        <div className="secret-field">
          <input
            value={l2Secret}
            onChange={(e) => setL2Secret(e.target.value)}
            placeholder="0x…"
            type={showL2Secret ? "text" : "password"}
            autoComplete="off"
          />
          <button
            type="button"
            className="ghost secret-toggle"
            disabled={!l2Secret}
            aria-label={showL2Secret ? "Hide L2 secret" : "Show L2 secret"}
            title={showL2Secret ? "Hide" : "Show"}
            onClick={() => setShowL2Secret((v) => !v)}
          >
            {showL2Secret ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 6a9.77 9.77 0 0 1 8.94 5.5 9.77 9.77 0 0 1-17.88 0A9.77 9.77 0 0 1 12 6m0-2C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
                />
                <path
                  fill="currentColor"
                  d="M3.27 2 2 3.27 5.11 6.4A12.4 12.4 0 0 0 1 11.5C2.73 15.89 7 19 12 19c1.85 0 3.58-.45 5.12-1.23L19.73 21 21 19.73 3.27 2zM12 17c-3.53 0-6.43-2.07-8-5.5a9.9 9.9 0 0 1 2.55-3.36l1.58 1.58A2.5 2.5 0 0 0 12 14.5c.4 0 .78-.1 1.12-.26l1.58 1.58A8.2 8.2 0 0 1 12 17z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 4C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 12.5A2.5 2.5 0 1 1 12 9a2.5 2.5 0 0 1 0 5.5zM12 7c-2.48 0-4.5 2.02-4.5 4.5S9.52 16 12 16s4.5-2.02 4.5-4.5S14.48 7 12 7z"
                />
              </svg>
            )}
          </button>
        </div>
      </label>
      <label>
        Salt (optional, default 0)
        <input
          value={l2Salt}
          onChange={(e) => setL2Salt(e.target.value)}
          placeholder="0x0… or leave empty"
          autoComplete="off"
        />
      </label>
    </div>
    );
  };

  return (
    <>
      <TopBar
        wallet={wallet}
        ethSessionOk={ethSessionOk}
        shellReady={shellReady}
        onConnect={() => void onConnect()}
      />
      <main className={progress ? "with-progress-panel app-shell app-main" : "app-shell app-main"}>
      {!shellReady ? (
        <ConnectSessionGate
          ethConnected={!!wallet}
          ethSessionOk={ethSessionOk}
          pxeReady={
            !!dfPxeAccount && isBridgeReadyDfPxeAccount(dfPxeAccount, wallet?.address)
          }
          dfpunkPlayUrl={DFPUNK_PLAY_URL}
          canImportPxe={
            ethSessionOk && BROWSER_CLAIM && !!networkMeta?.aztecNodeUrl && !!wallet
          }
          importingPxe={gateImportingPxe}
          importError={gateImportError ?? walletConnectError}
          onImportPxeFile={importPxeFromGate}
        />
      ) : (
        <>
      <p className="brand-lead app-lead">
        Connect an Ethereum wallet, fund an Aztec address, and claim Fee Juice. Styled for the{" "}
        <a href={BRIDGE_PUBLIC_URL} target="_blank" rel="noreferrer">
          df/atlas
        </a>{" "}
        stack — play on{" "}
        <a href={DFPUNK_PLAY_URL} target="_blank" rel="noreferrer">
          dfpunk aztec
        </a>
        . Protocol fee {BRIDGE_FEE_BPS / 100}% AZTEC + mainnet ETH (~1 L1 tx) → L1 treasury.
      </p>

      {path === ROUTES.bridge ? (
      <div className="fee-juice-notice" role="note">
        <div className="fee-juice-notice-content">
          <strong className="fee-juice-notice-title">
            <span className="fee-juice-notice-icon" aria-hidden="true">
              !
            </span>
            Important — read before bridging
          </strong>
          <p>
            Bridging is <strong>one-way and irreversible</strong>. Once on Aztec, your
            $AZTEC becomes Fee Juice — it cannot be withdrawn, transferred to another
            account, or bridged back to Ethereum or another chain.{" "}
            <strong className="fee-juice-emphasis">Only bridge the amount you need.</strong>
          </p>
        </div>
        <button
          type="button"
          className="icon-btn notice-details-btn"
          aria-label="Details"
          title="Details"
          onClick={() => setFeeJuiceDetailsOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M10.5 16.5h3v3h-3v-3zm1.5-13c2.9 0 5.25 1.85 5.25 4.35 0 2.1-1.35 3.15-2.55 3.9-.9.6-1.35 1.05-1.35 1.8v.7h-2.7v-.9c0-1.5.9-2.4 1.95-3.15 1.05-.75 1.8-1.35 1.8-2.4 0-1.05-.9-1.8-2.25-1.8-1.5 0-2.55.9-2.7 2.25H6.75C7.05 5.7 8.85 3.5 12 3.5z"
            />
          </svg>
        </button>
      </div>
      ) : null}

      {path === ROUTES.network ? (
        <section className="route-page" aria-label="Network">
          <NetworkIntegrityPanel network={networkMeta} />
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
        </section>
      ) : null}

      {path === ROUTES.vault ? (
        <section className="route-page" aria-label="Vault">
          <VaultPage />
        </section>
      ) : null}

      {path !== ROUTES.network && path !== ROUTES.vault && wallet && ethSessionOk ? (
        <>
      {path === ROUTES.bridge ? (
        <>
      <div className="bridge-layout">
      <p className="hint bridge-layout-hint">
        Bridging on <span className="mono">mainnet</span> via <span className="mono">portal</span>.
        {hasRpcOverrides(rpcOverrides)
          ? " Custom RPC overrides active — verify hosts before signing."
          : null}
      </p>

      <div className="bridge-grid">
        <div className="bridge-col bridge-col-account">
          {wallet ? (
            <div className="card wallet-status">
              <div className="wallet-status-account">
                <strong>L1 account</strong>
                <div className="wallet-card-address">
                  <span className="mono">
                    {wallet.address.slice(0, 10)}…{wallet.address.slice(-8)}
                  </span>
                  <button
                    type="button"
                    className="copy-address-btn"
                    aria-label="Copy wallet address"
                    title="Copy address"
                    onClick={() => void copyWalletAddress()}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M8 7V5c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2h-2v2c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h2Zm2 0h5c1.1 0 2 .9 2 2v5h2V5h-9v2Zm-4 2v9h9V9H6Z"
                      />
                    </svg>
                  </button>
                  {addressCopied ? (
                    <span className="copy-success" role="status">
                      Copied!
                    </span>
                  ) : null}
                </div>
                <p className="hint">
                  Chain id: {wallet.chainId}
                  {networkMeta && wallet.chainId !== networkMeta.l1ChainId
                    ? ` (expected ${networkMeta.l1ChainId} — switch in wallet)`
                    : ""}
                </p>
                <p className="hint">
                  Bridging deducts from the L1 balance below.
                  {networkMeta?.l1Addresses.feeAssetHandler
                    ? " Testnet can mint via faucet if you have no tokens."
                    : " Mainnet requires L1 AZTEC + ETH for gas."}
                </p>
              </div>
              <div className="wallet-status-balance">
                <div className="wallet-status-balance-main">
                  {balanceRefreshing ? null : feeBalance ? (
                    <span
                      className="balance-amount mono"
                      title={`${feeBalance.formatted} ${feeBalance.symbol}`}
                    >
                      {feeBalance.formatted}{" "}
                      <span className="balance-symbol">{feeBalance.symbol}</span>
                    </span>
                  ) : (
                    <span className={`balance-amount hint ${balanceError ? "error" : ""}`}>
                      {balanceError ? "Failed" : "Loading…"}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`icon-btn${balanceRefreshing ? " spinning" : ""}`}
                    aria-label="Refresh balance"
                    title="Refresh balance"
                    disabled={busy || !networkMeta || balanceRefreshing}
                    onClick={() => {
                      if (wallet && networkMeta) {
                        void refreshFeeBalance(wallet, networkMeta, { spin: true });
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
                      />
                    </svg>
                  </button>
                </div>
                {!balanceRefreshing && balanceError ? (
                  <p className="hint error balance-error">{balanceError}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {dfPxeReady ? null : (
            <p className="hint">
              Open <strong>Wallets</strong> (top right): validate MetaMask/WalletConnect, then{" "}
              <strong>Import from DF client → PXE</strong>. Generic file import does not unlock
              bridge.
            </p>
          )}

          <label className="bridge-recipient-field">
            Aztec recipient (DF Punk PXE)
            <input
              value={recipient}
              onChange={(e) => {
                if (dfPxeAccount) return;
                setRecipient(e.target.value);
                setDfPxeAccount(null);
              }}
              readOnly={!!dfPxeAccount}
              placeholder="Import DF Punk account into PXE first"
            />
          </label>
          {dfPxeReady ? (
            <p className="hint storage-status-ok">
              Locked to PXE session · bound{" "}
              <span className="mono">{shortHash(wallet!.address)}</span>
            </p>
          ) : (
            <p className="hint">
              Bridge stays locked until a DF Punk account is imported into PXE for this connector.
            </p>
          )}
          {dfPxeReady ? (
            <div className="card pxe-balance-card">
              <div className="pxe-balance-head">
                <strong>Aztec PXE Fee Juice</strong>
                <button
                  type="button"
                  className={`icon-btn${l2BalanceRefreshing ? " spinning" : ""}`}
                  aria-label="Refresh Aztec Fee Juice balance"
                  title="Refresh L2 Fee Juice"
                  disabled={busy || l2BalanceRefreshing || !networkMeta?.aztecNodeUrl}
                  onClick={() => {
                    if (dfPxeAccount?.address && networkMeta?.aztecNodeUrl) {
                      void refreshL2FeeBalance(dfPxeAccount.address, networkMeta.aztecNodeUrl, {
                        spin: true,
                      });
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
                    />
                  </svg>
                </button>
              </div>
              <div className="pxe-balance-main">
                {l2BalanceRefreshing ? (
                  <span className="balance-amount hint">Loading…</span>
                ) : l2FeeBalance != null ? (
                  <span className="balance-amount mono" title={`${formatFjAmount(l2FeeBalance)} FJ`}>
                    {formatFjAmount(l2FeeBalance)} <span className="balance-symbol">FJ</span>
                  </span>
                ) : (
                  <span className={`balance-amount hint ${l2BalanceError ? "error" : ""}`}>
                    {l2BalanceError ? "Failed" : "—"}
                  </span>
                )}
              </div>
              {!l2BalanceRefreshing && l2BalanceError ? (
                <p className="hint error balance-error">{l2BalanceError}</p>
              ) : (
                <p className="hint">Public Fee Juice on Aztec for this PXE account.</p>
              )}
            </div>
          ) : null}
          {isSponsoredFpcAddress(recipient) ? (
            <p className="error">
              Sponsored FPC is not a DF Punk user account — bridge button stays locked. Use DF
              client import → PXE for play accounts.
            </p>
          ) : null}
        </div>

        <div className="bridge-col bridge-col-action">
          <div className="card bridge-amount-card">
            <div className="amount-field">
              <div className="amount-field-head">
                <label htmlFor="bridge-amount-input">Amount (FJ)</label>
                {wallet && feeBalance ? (
                  <div className="amount-balance-row">
                    <span className="hint amount-balance">
                      <span className="mono">
                        {formatFjAmount(feeBalance.balance)} {feeBalance.symbol}
                      </span>
                    </span>
                    {amountQuickAction ? (
                      <button
                        type="button"
                        className="ghost amount-max-btn"
                        disabled={busy || balanceRefreshing}
                        onClick={applyAmountQuickFill}
                      >
                        {amountQuickAction.label}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="bridge-amount-input-row">
                <input
                  id="bridge-amount-input"
                  value={amountFj}
                  onChange={(e) => setAmountFj(e.target.value)}
                  inputMode="decimal"
                  placeholder={`Min ${MIN_BRIDGE_FJ}`}
                  className={
                    amountFj.trim() && (amountCheck.error || shortfall)
                      ? "input-invalid bridge-amount-input"
                      : "bridge-amount-input"
                  }
                  aria-invalid={
                    amountFj.trim() && (amountCheck.error || shortfall) ? true : undefined
                  }
                  aria-describedby="bridge-amount-help"
                />
                <span className="bridge-amount-unit mono" aria-hidden="true">
                  FJ
                </span>
              </div>
              <p
                id="bridge-amount-help"
                className={
                  amountFj.trim() && (amountCheck.error || shortfall) ? "error" : "hint"
                }
              >
                {!amountFj.trim()
                  ? `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`
                  : amountCheck.error
                    ? amountCheck.error
                    : shortfall
                      ? `Insufficient balance`
                      : `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`}
              </p>
              {feeSplit && !amountCheck.error ? (
                <p className="hint fee-split mono">
                  Net {formatUnits(feeSplit.net, 18)} · fee {formatUnits(feeSplit.fee, 18)} (
                  {BRIDGE_FEE_BPS / 100}%)
                  {ethServiceFeeWei != null && ethServiceFeeWei > 0n
                    ? ` · ETH ${formatEther(ethServiceFeeWei)}`
                    : networkMeta && shouldChargeBridgeEthServiceFee(networkMeta.l1ChainId)
                      ? " · ETH fee…"
                      : ""}
                </p>
              ) : null}
            </div>
          </div>

          <label className="check bridge-autoclaim">
            <input
              type="checkbox"
              checked={autoClaim}
              onChange={(e) => setAutoClaim(e.target.checked)}
            />
            <span>
              Auto claim on L2 after bridge
              {BROWSER_CLAIM ? " (browser PXE)" : " (API)"}
            </span>
          </label>

          {autoClaim ? (
            renderClaimKeyFields()
          ) : (
            <p className="hint">
              Auto-claim off — download credentials after L1 and claim via CLI later.
            </p>
          )}

          <ActionHintButton
            label={busy ? "Working…" : bridgeButtonLabel}
            ready={canBridge}
            busy={busy}
            onClick={requestBridge}
          />
        </div>
      </div>

      {showBridgeResult && l1TxHash ? (
        <div className="card">
          <strong>L1 transaction</strong>
          <p className="mono">{l1TxHash}</p>
          <TxAnalysisLinks
            networkId={networkId}
            l1ExplorerUrl={networkMeta?.l1ExplorerUrl}
            aztecExplorerUrl={networkMeta?.aztecExplorerUrl}
            l1TxHash={l1TxHash}
            l2TxHash={l2TxHash}
          />
        </div>
      ) : null}

      {showBridgeResult && credentials ? (
        <div className="card">
          <strong>Claim credentials</strong>
          <p className="hint">
            Saved in this browser (localStorage) and auto-downloaded after L1 bridge. Keep the
            downloaded copy until the L2 claim succeeds.
          </p>
          <p className="mono">{JSON.stringify(credentials, null, 2)}</p>
          <button
            type="button"
            className="ghost"
            onClick={() =>
              downloadClaimCredentials(credentials.recipient, credentials, {
                l1TxHash: l1TxHash ?? undefined,
                networkId,
              })
            }
          >
            Download credentials JSON
          </button>

          {!autoClaim ? (
            <button
              type="button"
              onClick={() => {
                if (l1TxHash) setSelectedRecoveryHash(l1TxHash);
                navigate(ROUTES.recover);
              }}
            >
              Recover this claim
            </button>
          ) : null}

          {claimJobId ? (
            <p>
              Claim job: <span className="mono">{claimJobId}</span> — {claimStatus}
            </p>
          ) : null}
          {l2TxHash ? (
            <p>
              L2 tx: <span className="mono">{l2TxHash}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      </div>
        </>
      ) : null}

      {path === ROUTES.recover ? (
        <>
          <div className="card recovery-status">
            <strong>Browser storage</strong>
            {storageReady === null ? (
              <p className="hint">Checking storage…</p>
            ) : storageReady ? (
              <p className="hint">✓ Storage ready — recovery data persists in this browser.</p>
            ) : (
              <p className="error">{storageError ?? "Browser storage is unavailable."}</p>
            )}
          </div>

          {recoverySessions.length === 0 ? (
            <div className="card recovery-empty">
              <strong>No unfinished claim found</strong>
              <p className="hint">
                This browser has no saved claim sessions. Return to Bridge to start a new deposit.
              </p>
            </div>
          ) : (
            <div className="card recovery-session-list-card">
              <strong>Unfinished sessions ({recoverySessions.length})</strong>
              <ul className="recovery-session-list">
                {recoverySessions.map((session) => {
                  const key = normalizeL1TxHash(session.l1TxHash);
                  const isSelected =
                    !!selectedSession && normalizeL1TxHash(selectedSession.l1TxHash) === key;
                  return (
                    <li
                      key={key}
                      className={`recovery-session-row${isSelected ? " active" : ""}`}
                    >
                      <button
                        type="button"
                        className="recovery-session-item"
                        onClick={() => selectRecoverySession(session)}
                      >
                        <span className="recovery-session-phase">{phaseLabel(session.phase)}</span>
                        <span className="mono recovery-session-hash">L1 {shortHash(session.l1TxHash)}</span>
                        {session.l2TxHash ? (
                          <span className="mono recovery-session-hash">
                            L2 {shortHash(session.l2TxHash)}
                          </span>
                        ) : null}
                        <span className="hint">
                          {formatUnits(BigInt(session.claimAmount), 18)} FJ →{" "}
                          {shortHash(session.recipient)}
                        </span>
                        <span className="hint">
                          Updated {new Date(session.updatedAt).toISOString()}
                        </span>
                      </button>
                      {session.credentials ? (
                        <button
                          type="button"
                          className="ghost recovery-session-download"
                          title="Download the claim credentials JSON for this bridge"
                          onClick={() =>
                            downloadClaimCredentials(
                              session.credentials!.recipient,
                              session.credentials!,
                              { l1TxHash: session.l1TxHash, networkId },
                            )
                          }
                        >
                          Download JSON
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Hidden for now — uncomment to re-enable importing a claim-*.json.
              The handler (onClaimCredentialsFile) and parser are still in place.
          <div className="card credentials-import-card">
            <strong>Add a claim from a credentials JSON</strong>
            <p className="hint">
              Use this to recover a bridge made in another browser or on another device. Pick
              the <span className="mono">claim-*.json</span> that was downloaded after the L1
              deposit — it carries the claim secret, which cannot be derived from an address.
            </p>
            <label className="recovery-file-label">
              <span className="recovery-file-label-text">Choose claim-*.json</span>
              <input
                type="file"
                accept="application/json,.json,.txt,text/plain"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void onClaimCredentialsFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {credentialsImportError ? (
              <p className="error credentials-import-message">{credentialsImportError}</p>
            ) : null}
            {credentialsImportNotice ? (
              <p className="hint credentials-import-message credentials-import-ok">
                {credentialsImportNotice}
              </p>
            ) : null}
          </div>
          */}

          {selectedSession ? (
            <div className="card claim-recovery-guide" id="recovery-session-guide">
              <strong>{phaseLabel(selectedSession.phase)}</strong>
              <p className="hint">
                L1 tx: <span className="mono">{selectedSession.l1TxHash}</span>
              </p>
              {selectedSession.l2TxHash ? (
                <p className="hint">
                  L2 tx: <span className="mono">{selectedSession.l2TxHash}</span>
                </p>
              ) : null}
              <TxAnalysisLinks
                networkId={networkId}
                l1ExplorerUrl={networkMeta?.l1ExplorerUrl}
                aztecExplorerUrl={networkMeta?.aztecExplorerUrl}
                l1TxHash={selectedSession.l1TxHash}
                l2TxHash={selectedSession.l2TxHash}
              />
              {selectedSession.credentials ? (
                <p>
                  Claim amount:{" "}
                  <strong className="mono">
                    {formatUnits(BigInt(selectedSession.credentials.claimAmount), 18)} FJ
                  </strong>
                </p>
              ) : null}
              {selectedSession.lastError ? (
                <p className="error">{selectedSession.lastError}</p>
              ) : null}

              <p className="recovery-steps-title">What to do next</p>
              <ol className="recovery-steps">
                {recoverySteps(selectedSession.phase).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>

              {selectedSession.phase === "l1-pending" ? (
                <>
                  <p className="hint">
                    Waiting for L1 confirmation. This is retried automatically when the page
                    loads — you can also retry it now.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retryResumeL1(selectedSession)}
                  >
                    Retry resume
                  </button>
                </>
              ) : null}

              {selectedSession.phase === "claim-sent" ? (
                <>
                  <p className="hint">
                    The L2 claim transaction was already submitted. No account import is
                    needed — just wait for confirmation.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void waitForSessionL2(selectedSession)}
                  >
                    Wait for L2 confirmation
                  </button>
                </>
              ) : null}

              {selectedSession.phase === "ready-to-claim" ||
              selectedSession.phase === "claiming" ||
              selectedSession.phase === "failed" ? (
                <>
                  <p className="hint">
                    Import the original Aztec account JSON for{" "}
                    <span className="mono">{selectedSession.credentials?.recipient}</span> to
                    resume the L2 claim. Account keys are used only in memory and are not
                    persisted.
                  </p>
                  {renderAccountImportCard({
                    id: "aztec-recovery-account-import",
                    highlight: true,
                    hint: (
                      <>
                        Upload <span className="mono">dfpunk-account-*.json</span> with{" "}
                        <span className="mono">address / secretKey / salt / signingKey</span> for{" "}
                        <span className="mono">{selectedSession.credentials?.recipient}</span>.
                        Fills the fields below (signingKey is required for dfpunk accounts).
                      </>
                    ),
                    onFile: (f) =>
                      void onAccountFile(f, {
                        expectedRecipient: selectedSession.credentials?.recipient,
                        forRecovery: true,
                      }),
                    onSelectAccount: (i) => {
                      setImportedIndex(i);
                      const acc = importedAccounts[i];
                      if (acc) {
                        applyImportedAccount(acc, {
                          expectedRecipient: selectedSession.credentials?.recipient,
                          forRecovery: true,
                        });
                      }
                    },
                  })}
                  {renderClaimKeyFields()}
                  <label>
                    Aztec recipient address
                    <input
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x… (32-byte Aztec address)"
                      readOnly={!!selectedSession.credentials?.recipient}
                    />
                  </label>
                  <ActionHintButton
                    label={
                      busy
                        ? "Working…"
                        : recoveryAccountReady
                          ? "Resume L2 claim"
                          : "Import the matching account to continue"
                    }
                    ready={recoveryAccountReady}
                    busy={busy}
                    onClick={() => void onResumeClaim(selectedSession)}
                  />
                </>
              ) : null}

              <div className="modal-actions recovery-session-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void onRemoveSession(selectedSession)}
                >
                  Remove session
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
        </>
      ) : null}

      {progress ? null : bridgePhase ? (
        <p className={`bridge-phase${busy ? " active" : ""}`}>
          {busy ? "⏳ " : "✓ "}
          {bridgePhase}
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {progress ? (
        <ProgressPanel
          progress={progress}
          detail={bridgePhase}
          onDismiss={() => {
            setProgress(null);
            setBridgePhase(null);
          }}
        />
      ) : null}
        </>
      )}

      <WalletDrawer
        networkId={networkId}
        aztecNodeUrl={networkMeta?.aztecNodeUrl ?? null}
        busy={busy}
        connectingWallet={connectingWallet}
        connectError={walletConnectError}
        ethWallet={wallet}
        onEthSessionValidated={setEthSessionOk}
        onConnectEth={() => void onConnect()}
        onDisconnectEth={() => void onDisconnect()}
        onApplyAztecAccount={(acc) => applyImportedAccount(acc)}
        onClearAztecAccount={() => {
          setDfPxeAccount(null);
          setVaultPxeAccount(null);
          lockVaultUi();
          setRecipient("");
          setL2Secret("");
          setL2Salt("0");
          setL2SigningKey("");
        }}
        pickerOpen={pickerOpen}
        availableWallets={availableWallets}
        connectDetail={(d) => void connectDetail(d)}
        onConnectWalletConnect={() => void onConnectWalletConnect()}
        closeWalletPicker={closeWalletPicker}
        wcUri={wcUri}
        walletPickerRef={walletPickerRef}
        wcProjectId={WC_PROJECT_ID}
        hasNetwork={!!networkMeta}
      />

      {feeJuiceDetailsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFeeJuiceDetailsOpen(false);
          }}
        >
          <div
            className="modal fee-juice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fee-juice-details-title"
          >
            <div className="modal-header">
              <strong id="fee-juice-details-title">Before you bridge</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                title="Close"
                onClick={() => setFeeJuiceDetailsOpen(false)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                  />
                </svg>
              </button>
            </div>
            <p>
              The <strong>$AZTEC</strong> you deposit on Ethereum is converted{" "}
              <strong>1:1</strong> into <strong>Fee Juice</strong> on Aztec.
            </p>
            <ul>
              <li>
                <strong>One-way and irreversible:</strong> it cannot be withdrawn or bridged
                back to Ethereum or any other chain.
              </li>
              <li>
                <strong>Non-transferable:</strong> Fee Juice stays with the recipient address
                and cannot be sent to another account.
              </li>
              <li>
                <strong>Public balance:</strong> Fee Juice balances are public on-chain, while
                your transactions remain private.
              </li>
              <li>
                <strong className="fee-juice-emphasis">Only bridge the amount you need.</strong>
              </li>
            </ul>
            <a
              className="official-docs-link"
              href={OFFICIAL_DOCS_FEE_JUICE}
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more in the official Aztec documentation ↗
            </a>
          </div>
        </div>
      ) : null}

      {bridgeConfirmOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBridgeConfirmOpen(false);
          }}
        >
          <div
            className="modal bridge-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bridge-confirm-title"
          >
            <div className="modal-header">
              <strong id="bridge-confirm-title">Protect your claim credentials</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                title="Close"
                onClick={() => setBridgeConfirmOpen(false)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                  />
                </svg>
              </button>
            </div>
            <div className="recovery-warning">
              <strong>Claim credentials are required to recover your funds on Aztec.</strong>
              <p>
                This browser will automatically save recovery data as soon as the L1
                transaction is submitted. After L1 confirmation, the complete credentials
                JSON will download automatically.
              </p>
              {ethServiceFeeWei != null && ethServiceFeeWei > 0n ? (
                <p className="mono">
                  Mainnet wallet confirm batches ETH service fee {formatEther(ethServiceFeeWei)} ETH
                  + {BRIDGE_FEE_BPS / 100}% AZTEC fee + approve + deposit →{" "}
                  {BRIDGE_FEE_RECIPIENT.slice(0, 10)}… (when your wallet supports batching).
                </p>
              ) : null}
              <p>
                Complete credentials do not exist until the L1 receipt is confirmed. Keep
                this page open, allow the download, and store the JSON somewhere safe.
              </p>
            </div>
            <p className={storageReady ? "hint storage-status-ok" : "error storage-status-error"}>
              {storageReady === null
                ? "Checking browser storage…"
                : storageReady
                  ? "✓ Browser storage ready — recovery data will be saved in this browser."
                  : storageError ?? "Browser storage unavailable — recovery data cannot be saved."}
            </p>
            <label className="check recovery-confirmation">
              <input
                type="checkbox"
                checked={recoveryAcknowledged}
                onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
              />
              <span>
                I understand that I must keep the downloaded claim credentials until the L2
                claim succeeds.
              </span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setBridgeConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!recoveryAcknowledged || storageReady !== true}
                onClick={() => {
                  setBridgeConfirmOpen(false);
                  void onBridge();
                }}
              >
                Continue to wallet
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {recoveryPromptOpen && selectedSession?.credentials ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal recovery-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-recovery-title"
          >
            <div className="modal-header">
              <strong id="claim-recovery-title">Unfinished claim found</strong>
            </div>
            <div className="recovery-warning">
              <strong>Saved claim credentials were recovered from this browser.</strong>
              <p>
                {phaseLabel(selectedSession.phase)} —{" "}
                <span className="mono">
                  {formatUnits(BigInt(selectedSession.credentials.claimAmount), 18)} FJ
                </span>{" "}
                is still waiting for you. Your Ethereum wallet is not needed to finish it.
              </p>
            </div>

            <p className="recovery-steps-title">What to do next</p>
            <ol className="recovery-steps">
              {recoverySteps(selectedSession.phase, { includeNavigation: true }).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <p className="hint">
              Recipient account:{" "}
              <span className="mono">{selectedSession.credentials.recipient}</span>
              <br />
              L1 tx: <span className="mono">{shortHash(selectedSession.l1TxHash)}</span>
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setRecoveryPromptOpen(false);
                  navigate(ROUTES.bridge);
                }}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryPromptOpen(false);
                  void selectRecoverySession(selectedSession);
                  navigate(ROUTES.recover);
                  window.setTimeout(() => {
                    const target =
                      document.getElementById("aztec-recovery-account-import") ??
                      document.getElementById("recovery-session-guide");
                    target?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 0);
                }}
              >
                {selectedSession.phase === "claim-sent"
                  ? "Wait for confirmation"
                  : "Resume claim"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSettings();
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rpc-settings-title">
            <div className="modal-header">
              <strong id="rpc-settings-title">RPC settings</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                title="Close"
                onClick={() => closeSettings()}
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
              Overrides for <span className="mono">{networkId}</span>. Saved in the password vault
              when unlocked. Leave as defaults or clear and save to reset.
            </p>
            <AztecRpcOptionsField
              value={draftAztecUrl}
              networkDefaultUrl={getNetwork(networkId).aztecNodeUrl}
              preferredUrls={
                networkId === "mainnet" ? [AZTEC_MAINNET_NODE_PUBLIC] : undefined
              }
              onChange={setDraftAztecUrl}
            />
            <label>
              L1_RPC_URL
              <input
                value={draftL1RpcUrl}
                onChange={(e) => setDraftL1RpcUrl(e.target.value)}
                placeholder={getNetwork(networkId).l1RpcUrl}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={resetSettingsDraft}>
                Reset defaults
              </button>
              <button type="button" className="ghost" onClick={() => closeSettings()}>
                Cancel
              </button>
              <button type="button" onClick={saveSettings}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </main>
    </>
  );
}
