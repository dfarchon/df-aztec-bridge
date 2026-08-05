import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatUnits, type Hex } from "viem";
import {
  bridgeFromConnectedWallet,
  connectEvmWalletDetail,
  connectWalletConnect,
  discoverWallets,
  formatWalletError,
  getFeeJuiceBalance,
  isWalletUserRejection,
  resumePendingBridge,
  switchWalletChain,
  watchProviderSession,
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
  listNetworkIds,
  type WebNetworkConfig,
} from "./config/networks.js";
import { readAccountFile, type ImportedAztecAccount } from "./lib/account-import.js";
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
} from "./lib/bridge-session.js";
import { phaseLabel, recoverySteps, selectSessionForUi, shortHash } from "./lib/claim-recovery.js";
import {
  bridgeShortfall,
  MIN_BRIDGE_FJ,
  parseBridgeAmount,
} from "./lib/bridge-amount.js";
import { parseClaimCredentialsFile } from "./lib/claim-credentials-import.js";
import {
  downloadClaimCredentials,
  persistClaimCredentials,
} from "./lib/claim-credentials-store.js";
import {
  advanceProgress,
  bridgePhaseStep,
  claimPhaseStep,
  finishProgress,
  shouldBlockUnload,
  startProgress,
  type ProgressState,
} from "./lib/progress-track.js";
import { ProgressPanel } from "./ProgressPanel.js";
import {
  getRpcOverrides,
  hasRpcOverrides,
  setRpcOverrides,
  type RpcOverrides,
} from "./lib/rpc-overrides.js";

type NetworkMeta = WebNetworkConfig;
type AppTab = "bridge" | "recover";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";
/** Build-time: include / use in-browser PXE claim (heavy chunk). */
const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM === "true";

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

function withRpcOverrides(networkId: string, overrides: RpcOverrides): NetworkMeta {
  const base = getNetwork(networkId);
  return {
    ...base,
    aztecNodeUrl: overrides.aztecNodeUrl?.trim() || base.aztecNodeUrl,
    l1RpcUrl: overrides.l1RpcUrl?.trim() || base.l1RpcUrl,
  };
}

function storageErrorMessage(e: unknown): string {
  if (e instanceof BridgeStorageError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

function loadInitialSession(networkId: string): BridgeSessionEntry | null {
  try {
    return getActiveSession(networkId) ?? listIncompleteSessions(networkId)[0] ?? null;
  } catch {
    return null;
  }
}

function loadInitialSessions(networkId: string): BridgeSessionEntry[] {
  try {
    return listIncompleteSessions(networkId);
  } catch {
    return [];
  }
}

export function App() {
  const [networks] = useState(() => listNetworkIds());
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK_ID);
  const [initialSession] = useState(() => loadInitialSession(DEFAULT_NETWORK_ID));
  /** UI default portal; selector disabled for now. */
  const [l1Backend, setL1Backend] = useState<L1BridgeBackend>("portal");
  const [rpcOverrides, setRpcOverridesState] = useState<RpcOverrides>(() =>
    getRpcOverrides(DEFAULT_NETWORK_ID),
  );
  const [networkMeta, setNetworkMeta] = useState<NetworkMeta | null>(() =>
    withRpcOverrides(DEFAULT_NETWORK_ID, getRpcOverrides(DEFAULT_NETWORK_ID)),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feeJuiceDetailsOpen, setFeeJuiceDetailsOpen] = useState(false);
  const [bridgeConfirmOpen, setBridgeConfirmOpen] = useState(false);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>("bridge");
  const [recoveryPromptOpen, setRecoveryPromptOpen] = useState(
    () => !!initialSession?.credentials,
  );
  const [draftAztecUrl, setDraftAztecUrl] = useState("");
  const [draftL1RpcUrl, setDraftL1RpcUrl] = useState("");
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amountFj, setAmountFj] = useState(() => {
    const savedAmount = initialSession?.credentials?.claimAmount ?? initialSession?.pending?.claimAmount;
    return savedAmount ? formatUnits(BigInt(savedAmount), 18) : "300";
  });
  /** When false: L1 bridge only — no L2 secret needed. */
  const [autoClaim, setAutoClaim] = useState(false);
  const [l2Secret, setL2Secret] = useState("");
  const [l2Salt, setL2Salt] = useState("");
  const [l2SigningKey, setL2SigningKey] = useState("");
  const [showL2Secret, setShowL2Secret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgePhase, setBridgePhase] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [l1TxHash, setL1TxHash] = useState<string | null>(initialSession?.l1TxHash ?? null);
  /**
   * Only a bridge started on this page shows its result cards. A session
   * restored from storage still seeds the state above (an API claim job needs it
   * to keep polling), but it belongs to the Recover tab, not the Bridge form.
   */
  const [showBridgeResult, setShowBridgeResult] = useState(false);
  const [credentials, setCredentials] = useState<ClaimCredentials | null>(
    initialSession?.credentials ?? null,
  );
  const [claimJobId, setClaimJobId] = useState<string | null>(initialSession?.claimJobId ?? null);
  const [claimStatus, setClaimStatus] = useState<string | null>(null);
  const [l2TxHash, setL2TxHash] = useState<string | null>(null);
  const [feeBalance, setFeeBalance] = useState<FeeJuiceBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [importedAccounts, setImportedAccounts] = useState<ImportedAztecAccount[]>([]);
  const [importedIndex, setImportedIndex] = useState(0);
  const [importName, setImportName] = useState<string | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [credentialsImportError, setCredentialsImportError] = useState<string | null>(null);
  const [credentialsImportNotice, setCredentialsImportNotice] = useState<string | null>(null);

  // Multi-session claim recovery (Recover tab).
  const [recoverySessions, setRecoverySessions] = useState<BridgeSessionEntry[]>(() =>
    loadInitialSessions(DEFAULT_NETWORK_ID),
  );
  const [selectedRecoveryHash, setSelectedRecoveryHash] = useState<string | null>(
    () => initialSession?.l1TxHash ?? null,
  );
  const [storageReady, setStorageReady] = useState<boolean | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const sessionRestoreStarted = useRef(false);
  const selectedSession = selectSessionForUi(recoverySessions, selectedRecoveryHash);

  const refreshSessions = useCallback(() => {
    const sessions = listIncompleteSessions(networkId);
    setRecoverySessions(sessions);
    return sessions;
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
      if (opts?.forRecovery) {
        setError(null);
        setBridgePhase("Recovery account verified — ready to resume claim");
      } else {
        setAutoClaim(true);
      }
    },
    [],
  );

  const onAccountFile = useCallback(
    async (file: File | null, opts?: AccountImportOptions) => {
      if (!file) return;
      setError(null);
      try {
        if (!file.name.toLowerCase().endsWith(".json") && file.type && file.type !== "application/json") {
          throw new Error("Please upload a .json account file");
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

  useEffect(() => {
    try {
      const overrides = getRpcOverrides(networkId);
      setRpcOverridesState(overrides);
      setNetworkMeta(withRpcOverrides(networkId, overrides));
      setError(null);
    } catch (e: unknown) {
      setNetworkMeta(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [networkId]);

  // Check browser storage once on mount — recovery cannot persist without it.
  useEffect(() => {
    try {
      assertBridgeStorageReady();
      setStorageReady(true);
      setStorageError(null);
    } catch (e: unknown) {
      setStorageReady(false);
      setStorageError(storageErrorMessage(e));
    }
  }, []);

  // Keep the recovery session list in sync with storage.
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const openSettings = useCallback(() => {
    const overrides = getRpcOverrides(networkId);
    const defaults = getNetwork(networkId);
    setDraftAztecUrl(overrides.aztecNodeUrl ?? defaults.aztecNodeUrl);
    setDraftL1RpcUrl(overrides.l1RpcUrl ?? defaults.l1RpcUrl);
    setSettingsOpen(true);
  }, [networkId]);

  const saveSettings = useCallback(() => {
    const defaults = getNetwork(networkId);
    const next: RpcOverrides = {
      aztecNodeUrl:
        draftAztecUrl.trim() && draftAztecUrl.trim() !== defaults.aztecNodeUrl
          ? draftAztecUrl.trim()
          : undefined,
      l1RpcUrl:
        draftL1RpcUrl.trim() && draftL1RpcUrl.trim() !== defaults.l1RpcUrl
          ? draftL1RpcUrl.trim()
          : undefined,
    };
    setRpcOverrides(networkId, next);
    setRpcOverridesState(next);
    setNetworkMeta(withRpcOverrides(networkId, next));
    setSettingsOpen(false);
  }, [networkId, draftAztecUrl, draftL1RpcUrl]);

  const resetSettingsDraft = useCallback(() => {
    const defaults = getNetwork(networkId);
    setDraftAztecUrl(defaults.aztecNodeUrl);
    setDraftL1RpcUrl(defaults.l1RpcUrl);
  }, [networkId]);

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

  const connectDetail = useCallback(
    async (detail: EIP6963ProviderDetail) => {
      setBusy(true);
      setError(null);
      setWcUri(null);
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
            if (isWalletUserRejection(switchErr)) {
              setError(
                `Connected to ${detail.info.name}, but network switch was cancelled. Switch to chain ${networkMeta.l1ChainId} in the wallet, then bridge.`,
              );
            } else {
              setError(formatWalletError(switchErr));
            }
            return;
          }
        }
        setWallet(connected);
        setPickerOpen(false);
      } catch (e: unknown) {
        setError(formatWalletError(e));
      } finally {
        setBusy(false);
      }
    },
    [networkMeta],
  );

  const onConnectWalletConnect = useCallback(async () => {
    if (!networkMeta) {
      setError("Select a network first.");
      return;
    }
    if (!WC_PROJECT_ID) {
      setError(
        "Set VITE_WALLETCONNECT_PROJECT_ID in repo-root .env (https://cloud.reown.com), then restart pnpm web.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setWcUri(null);
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
          setError(
            isWalletUserRejection(switchErr)
              ? `WalletConnect linked, but network switch was cancelled. Switch to chain ${networkMeta.l1ChainId} then bridge.`
              : formatWalletError(switchErr),
          );
          return;
        }
      }
      setWallet(connected);
      setWcUri(null);
      setPickerOpen(false);
    } catch (e: unknown) {
      setWcUri(null);
      setError(formatWalletError(e));
    } finally {
      setBusy(false);
    }
  }, [networkMeta]);

  const onConnect = useCallback(async () => {
    setError(null);
    setWcUri(null);
    try {
      const wallets = await discoverWallets(200);
      setAvailableWallets(wallets);
      setPickerOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // On mount (once networkMeta is ready): resume every saved session that is
  // still waiting on L1 confirmation or L2 claim confirmation. Only the
  // session that was active when the page loaded also drives the top-level
  // Bridge tab UI (bridgePhase / credentials / l1TxHash); the rest are
  // updated silently in storage and show up in the Recover tab list.
  useEffect(() => {
    if (!networkMeta || sessionRestoreStarted.current) return;
    sessionRestoreStarted.current = true;
    let cancelled = false;

    const activeKey = initialSession ? normalizeL1TxHash(initialSession.l1TxHash) : null;
    const sessions = refreshSessions();

    void Promise.all(
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
              pending: session.pending,
              chainId: networkMeta.l1ChainId,
              l1RpcUrl: networkMeta.l1RpcUrl,
            });
            if (cancelled) return;
            upsertSession(networkId, {
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
              setRecoveryPromptOpen(true);
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
            removeSession(networkId, session.l1TxHash);
            if (isActiveFlow) {
              setL2TxHash(session.l2TxHash);
              setClaimStatus("succeeded");
              setBridgePhase(`L2 claim complete — ${session.l2TxHash}`);
              setProgress((prev) => finishProgress(prev, "succeeded"));
              setRecoveryPromptOpen(false);
            }
          } catch (cause: unknown) {
            if (cancelled) return;
            const message = cause instanceof Error ? cause.message : String(cause);
            upsertSession(networkId, {
              l1TxHash: session.l1TxHash,
              phase: "failed",
              recipient: session.recipient,
              claimAmount: session.claimAmount,
              credentials: session.credentials,
              lastError: message,
              makeActive: false,
            });
            if (isActiveFlow) {
              setError(message);
              setProgress((prev) => finishProgress(prev, "failed"));
            }
          }
        }
      }),
    ).finally(() => {
      if (!cancelled) refreshSessions();
    });

    return () => {
      cancelled = true;
    };
  }, [networkMeta, networkId, initialSession, refreshSessions]);

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
          removeSession(networkId, l1Hash);
          refreshSessions();
          setClaimStatus("succeeded");
          setBridgePhase("Claim message already consumed — nothing to do");
          setProgress((prev) => finishProgress(prev, "succeeded"));
          setRecoveryPromptOpen(false);
          return;
        }

        setBridgePhase("Loading browser PXE (first time may download a large chunk)…");
        setProgress((prev) => advanceProgress(prev, { track: "claim", stepKey: "pxe" }));
        upsertSession(networkId, {
          l1TxHash: l1Hash,
          phase: "claiming",
          recipient: creds.recipient,
          claimAmount: creds.claimAmount,
          credentials: creds,
          makeActive: false,
        });
        refreshSessions();

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
            onTxSent: (l2Hash) => {
              setL2TxHash(l2Hash);
              setProgress((prev) =>
                advanceProgress(prev, {
                  track: "claim",
                  stepKey: "confirm",
                  txSubmitted: true,
                }),
              );
              upsertSession(networkId, {
                l1TxHash: l1Hash,
                phase: "claim-sent",
                recipient: creds.recipient,
                claimAmount: creds.claimAmount,
                credentials: creds,
                l2TxHash: l2Hash,
                makeActive: false,
              });
              refreshSessions();
            },
          });

          if (!hash) {
            // Message was consumed mid-flight (e.g. claimed elsewhere) — nothing left to do.
            removeSession(networkId, l1Hash);
            refreshSessions();
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
          removeSession(networkId, l1Hash);
          refreshSessions();
          return;
        } catch (claimError: unknown) {
          const message = claimError instanceof Error ? claimError.message : String(claimError);
          setProgress((prev) => finishProgress(prev, "failed"));
          upsertSession(networkId, {
            l1TxHash: l1Hash,
            phase: "failed",
            recipient: creds.recipient,
            claimAmount: creds.claimAmount,
            credentials: creds,
            lastError: message,
            makeActive: false,
          });
          refreshSessions();
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
      upsertSession(networkId, {
        l1TxHash: l1Hash,
        phase: "claiming",
        recipient: creds.recipient,
        claimAmount: creds.claimAmount,
        credentials: creds,
        claimJobId: body.jobId,
        claimChannel: "api",
        makeActive: false,
      });
      refreshSessions();
    },
    [networkId, networkMeta, refreshSessions],
  );

  const onBridge = useCallback(async () => {
    if (!wallet || !networkMeta) return;
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
        onPending: (pending: PendingBridge) => {
          setL1TxHash(pending.l1TxHash);
          setShowBridgeResult(true);
          upsertSession(networkId, {
            l1TxHash: pending.l1TxHash,
            phase: "l1-pending",
            recipient: pending.recipient,
            claimAmount: pending.claimAmount,
            pending,
          });
          refreshSessions();
        },
        onProgress: (phase: BridgeProgressPhase, detail?: string) => {
          const labels: Record<BridgeProgressPhase, string> = {
            prepare: "Preparing…",
            check_allowance: "Checking token allowance…",
            approve_wallet: "Confirm approve in wallet…",
            approve_wait: "Approve submitted — waiting for confirmation…",
            mint_wallet: "Confirm faucet mint in wallet…",
            mint_wait: "Mint submitted — waiting for confirmation…",
            bridge_wallet:
              backend === "portal"
                ? "Confirm FeeJuicePortal deposit in wallet…"
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
        upsertSession(networkId, {
          l1TxHash: result.l1TxHash,
          phase: "ready-to-claim",
          recipient: result.credentials.recipient,
          claimAmount: result.credentials.claimAmount,
          credentials: result.credentials,
        });
        refreshSessions();
      } catch (storageError: unknown) {
        backupErrors.push(
          `credentials could not be saved in this browser: ${storageErrorMessage(storageError)}`,
        );
      }

      try {
        persistClaimCredentials({
          networkId,
          l1TxHash: result.l1TxHash,
          recipient: result.credentials.recipient,
          credentials: result.credentials,
        });
      } catch (downloadError: unknown) {
        backupErrors.push(
          `credentials JSON could not be downloaded: ${storageErrorMessage(downloadError)}`,
        );
      }

      if (backupErrors.length > 0) {
        setError(`L1 bridge completed, but ${backupErrors.join("; ")}`);
      }

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
  ]);

  const selectRecoverySession = useCallback(
    (session: BridgeSessionEntry) => {
      setSelectedRecoveryHash(session.l1TxHash);
      setActiveSession(networkId, session.l1TxHash);
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

        const duplicate = listIncompleteSessions(networkId).find(
          (session) => normalizeL1TxHash(session.l1TxHash) === parsed.l1TxHash,
        );
        if (duplicate) {
          selectRecoverySession(duplicate);
          setCredentialsImportNotice(
            `Already in the list — L1 ${shortHash(duplicate.l1TxHash)} is ${phaseLabel(
              duplicate.phase,
            ).toLowerCase()}. Selected it below instead of adding a copy.`,
          );
          return;
        }

        const entry = upsertSession(networkId, {
          l1TxHash: parsed.l1TxHash,
          phase: "ready-to-claim",
          recipient: parsed.recipient,
          claimAmount: parsed.credentials.claimAmount,
          credentials: parsed.credentials,
        });
        refreshSessions();
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
          pending: session.pending,
          chainId: networkMeta.l1ChainId,
          l1RpcUrl: networkMeta.l1RpcUrl,
        });
        setProgress((prev) =>
          advanceProgress(prev, { track: "resume-l1", stepKey: "credentials" }),
        );
        upsertSession(networkId, {
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
        refreshSessions();
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
        removeSession(networkId, session.l1TxHash);
        refreshSessions();
        setBridgePhase(`L2 claim complete — ${session.l2TxHash}`);
        setProgress((prev) => finishProgress(prev, "succeeded"));
        setClaimStatus("succeeded");
        setL2TxHash(session.l2TxHash);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setProgress((prev) => finishProgress(prev, "failed"));
        upsertSession(networkId, {
          l1TxHash: session.l1TxHash,
          phase: "failed",
          recipient: session.recipient,
          claimAmount: session.claimAmount,
          credentials: session.credentials,
          lastError: message,
          makeActive: false,
        });
        refreshSessions();
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [networkMeta, networkId, refreshSessions],
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
        refreshSessions();
      }
    },
    [l2Secret, l2Salt, l2SigningKey, startClaimJob, refreshSessions],
  );

  const onRemoveSession = useCallback(
    (session: BridgeSessionEntry) => {
      removeSession(networkId, session.l1TxHash);
      const remaining = refreshSessions();
      const wasSelected =
        selectedSession &&
        normalizeL1TxHash(selectedSession.l1TxHash) === normalizeL1TxHash(session.l1TxHash);
      if (wasSelected) {
        const next = remaining[0] ?? null;
        setSelectedRecoveryHash(next?.l1TxHash ?? null);
        if (next) {
          selectRecoverySession(next);
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
        .then((job: { status: string; error?: string; result?: { l2TxHash?: string } }) => {
          setClaimStatus(job.status);
          if (job.status === "failed") {
            setError(job.error ?? "Claim failed");
            if (credentials) {
              upsertSession(networkId, {
                l1TxHash: currentL1Hash,
                phase: "failed",
                recipient: credentials.recipient,
                claimAmount: credentials.claimAmount,
                credentials,
                lastError: job.error ?? "Claim failed",
                makeActive: false,
              });
              refreshSessions();
            }
            clearInterval(t);
          }
          if (job.status === "succeeded") {
            if (job.result?.l2TxHash) setL2TxHash(job.result.l2TxHash);
            setRecoveryPromptOpen(false);
            removeSession(networkId, currentL1Hash);
            refreshSessions();
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

  const amountCheck = parseBridgeAmount(amountFj);
  // Networks with a fee asset handler mint whatever the deposit needs, so a low
  // wallet balance is not a blocker there.
  const canMintFeeJuice = !!networkMeta?.l1Addresses.feeAssetHandler;
  const shortfall =
    amountCheck.wei !== null && feeBalance && !canMintFeeJuice
      ? bridgeShortfall(amountCheck.wei, feeBalance.balance)
      : null;

  const canBridge =
    !!wallet &&
    !!recipient.trim() &&
    !!networkMeta &&
    !amountCheck.error &&
    !shortfall &&
    (!autoClaim || !!l2Secret.trim());
  const recoveryAccountReady =
    !!selectedSession?.credentials &&
    !!l2Secret.trim() &&
    recipient.trim().toLowerCase() === selectedSession.credentials.recipient.toLowerCase();

  const requestBridge = () => {
    if (amountCheck.error) {
      setError(amountCheck.error);
      return;
    }
    if (shortfall) {
      setError(
        `Not enough ${feeBalance?.symbol ?? "Fee Juice"} on L1 — you need ${shortfall.missingFormatted} more.`,
      );
      return;
    }
    if (autoClaim && !l2Secret.trim()) {
      setError("Auto-claim is on — enter the Aztec L2 secret for that recipient account.");
      return;
    }
    setError(null);
    setRecoveryAcknowledged(false);
    try {
      assertBridgeStorageReady();
      setStorageReady(true);
      setStorageError(null);
    } catch (e: unknown) {
      setStorageReady(false);
      setStorageError(storageErrorMessage(e));
    }
    setBridgeConfirmOpen(true);
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
            Upload <span className="mono">dfpunk-account-*.json</span> with{" "}
            <span className="mono">address / secretKey / salt / signingKey</span>. Fills the form
            below (signingKey is required for dfpunk accounts).
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
          {importDragOver ? "Release to upload" : "Drag & drop JSON here"}
        </p>
        <p className="hint">or click to choose a file</p>
        <label className="file-label">
          <span className="sr-only">Choose JSON file</span>
          <input
            type="file"
            accept="application/json,.json"
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

  const renderClaimKeyFields = () => (
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

  return (
    <main className={progress ? "with-progress-panel" : undefined}>
      <header className="app-header">
        <div>
          <h1>DF Aztec Bridge</h1>
          <p>
            Connect a wallet, enter the Aztec address to fund, and bridge on L1. L2 claim is optional —
            leave it off if you only need the deposit + credentials.
          </p>
        </div>
        <button
          type="button"
          className={`icon-btn settings-btn${hasRpcOverrides(rpcOverrides) ? " active" : ""}`}
          aria-label="RPC settings"
          title="RPC settings"
          onClick={openSettings}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.07 7.07 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.65 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.77 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
            />
          </svg>
        </button>
      </header>

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
              href="https://docs.aztec.network/participate/basics/fees#what-is-fee-juice"
              target="_blank"
              rel="noreferrer"
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

      {recoveryPromptOpen && initialSession?.credentials ? (
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
                {phaseLabel(initialSession.phase)} —{" "}
                <span className="mono">
                  {formatUnits(BigInt(initialSession.credentials.claimAmount), 18)} FJ
                </span>{" "}
                is still waiting for you. Your Ethereum wallet is not needed to finish it.
              </p>
            </div>

            <p className="recovery-steps-title">What to do next</p>
            <ol className="recovery-steps">
              {recoverySteps(initialSession.phase, { includeNavigation: true }).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <p className="hint">
              Recipient account:{" "}
              <span className="mono">{initialSession.credentials.recipient}</span>
              <br />
              L1 tx: <span className="mono">{shortHash(initialSession.l1TxHash)}</span>
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setRecoveryPromptOpen(false);
                  setActiveTab("bridge");
                }}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryPromptOpen(false);
                  selectRecoverySession(initialSession);
                  setActiveTab("recover");
                  window.setTimeout(() => {
                    const target =
                      document.getElementById("aztec-recovery-account-import") ??
                      document.getElementById("recovery-session-guide");
                    target?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 0);
                }}
              >
                {initialSession.phase === "claim-sent"
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
            if (e.target === e.currentTarget) setSettingsOpen(false);
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
                onClick={() => setSettingsOpen(false)}
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
              Overrides for <span className="mono">{networkId}</span>. Saved in this browser only.
              Leave as defaults or clear and save to reset.
            </p>
            <label>
              AZTEC_NODE_URL
              <input
                value={draftAztecUrl}
                onChange={(e) => setDraftAztecUrl(e.target.value)}
                placeholder={getNetwork(networkId).aztecNodeUrl}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
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
              <button type="button" className="ghost" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={saveSettings}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flow-tabs" role="tablist" aria-label="Bridge flows">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "bridge"}
          className={activeTab === "bridge" ? "active" : ""}
          onClick={() => setActiveTab("bridge")}
        >
          Bridge
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "recover"}
          className={activeTab === "recover" ? "active" : ""}
          onClick={() => setActiveTab("recover")}
        >
          Recover claim
          {recoverySessions.length > 0 ? (
            <span className="flow-tab-badge" aria-label="Unfinished claims available">
              {recoverySessions.length}
            </span>
          ) : null}
        </button>
      </div>

      {activeTab === "bridge" ? (
        <>
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
        {hasRpcOverrides(rpcOverrides) ? " Custom RPC overrides active (gear)." : null}
      </p>

      <button type="button" onClick={() => void onConnect()} disabled={busy}>
        {wallet
          ? `Connected (${wallet.name ?? "wallet"}): ${wallet.address.slice(0, 8)}…`
          : "Connect wallet"}
      </button>

      {wallet && shortfall && feeBalance ? (
        <div className="card balance-shortfall">
          <strong>Not enough {feeBalance.symbol} on L1</strong>
          <p>
            This bridge needs <span className="mono">{shortfall.neededFormatted}</span>{" "}
            {feeBalance.symbol}, but the connected wallet holds{" "}
            <span className="mono">{shortfall.haveFormatted}</span>. Get at least{" "}
            <span className="mono">{shortfall.missingFormatted}</span> more{" "}
            {feeBalance.symbol} on{" "}
            {networkMeta?.l1ChainId === 1 ? "Ethereum mainnet" : `chain ${networkMeta?.l1ChainId}`}{" "}
            before bridging.
          </p>
          <p className="hint">
            {feeBalance.symbol} is a normal ERC-20 on L1 — acquire it the way you would any
            token, send it to <span className="mono">{wallet.address}</span>, then refresh the
            balance below. You also need ETH for gas.
          </p>
          {networkMeta?.l1ExplorerUrl ? (
            <p className="hint">
              Token contract:{" "}
              <a
                href={`${networkMeta.l1ExplorerUrl}/token/${networkMeta.l1Addresses.feeJuice}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mono"
              >
                {networkMeta.l1Addresses.feeJuice}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      {wallet ? (
        <div className="card wallet-status">
          <div className="wallet-status-account">
            <strong>L1 account</strong>
            <p className="mono">{wallet.address}</p>
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
                <span className="balance-amount mono" title={`${feeBalance.formatted} ${feeBalance.symbol}`}>
                  {feeBalance.formatted}{" "}
                  <span className="balance-symbol">
                    {feeBalance.symbol}
                  </span>
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

      {pickerOpen ? (
        <div className="card wallet-picker">
          <strong>Choose wallet</strong>
          <p className="hint">
            {WC_PROJECT_ID
              ? "Browser extensions (EIP-6963) or mobile QR (WalletConnect)."
              : "Browser extensions detected via EIP-6963."}
          </p>

          {availableWallets.length > 0 ? (
            <ul className="wallet-list">
              {availableWallets.map((w) => (
                <li key={w.info.rdns}>
                  <button
                    type="button"
                    className="wallet-option"
                    disabled={busy}
                    onClick={() => void connectDetail(w)}
                  >
                    {w.info.icon ? <img src={w.info.icon} alt="" width={28} height={28} /> : null}
                    <span>{w.info.name}</span>
                    <span className="rdns">{w.info.rdns}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No browser extension detected.</p>
          )}

          {WC_PROJECT_ID ? (
            <>
              <button
                type="button"
                className="wallet-option wc"
                disabled={busy || !networkMeta}
                onClick={() => void onConnectWalletConnect()}
              >
                <span>Scan QR with mobile wallet</span>
                <span className="rdns">WalletConnect</span>
              </button>

              {wcUri ? (
                <div className="qr-box">
                  <QRCodeSVG value={wcUri} size={220} bgColor="#ffffff" fgColor="#000000" />
                  <p className="hint">Open MetaMask / OKX / Trust on your phone → Scan QR</p>
                </div>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            className="ghost"
            disabled={false}
            onClick={() => {
              setPickerOpen(false);
              setWcUri(null);
              setBusy(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {renderAccountImportCard({
        onFile: onAccountFile,
        onSelectAccount: (i) => {
          setImportedIndex(i);
          const acc = importedAccounts[i];
          if (acc) applyImportedAccount(acc);
        },
      })}

      <label>
        Aztec recipient address
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x… (32-byte Aztec address)"
        />
      </label>

      <label>
        Amount (FJ)
        <input
          value={amountFj}
          onChange={(e) => setAmountFj(e.target.value)}
          inputMode="decimal"
          aria-invalid={amountCheck.error ? true : undefined}
          aria-describedby="bridge-amount-help"
        />
      </label>
      <p id="bridge-amount-help" className={amountCheck.error ? "error" : "hint"}>
        {amountCheck.error ?? `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`}
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={autoClaim}
          onChange={(e) => setAutoClaim(e.target.checked)}
        />
        <span>
          Auto claim on L2 after bridge (needs Aztec account secret)
          {BROWSER_CLAIM
            ? " — runs in this browser (heavy PXE download)"
            : " — via API"}
        </span>
      </label>

      {autoClaim ? (
        renderClaimKeyFields()
      ) : (
        <p className="hint">Auto-claim off — after L1 succeeds you can download credentials and claim via CLI later.</p>
      )}

      <button type="button" onClick={requestBridge} disabled={busy || !canBridge}>
        {autoClaim ? "Bridge + auto claim" : "Bridge via wallet (L1 only)"}
      </button>

      {showBridgeResult && l1TxHash ? (
        <div className="card">
          <strong>L1 transaction</strong>
          <p className="mono">{l1TxHash}</p>
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
                setActiveTab("recover");
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
        </>
      ) : null}

      {activeTab === "recover" ? (
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
                          Updated {new Date(session.updatedAt).toLocaleString()}
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
                accept="application/json,.json"
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
                  <button
                    type="button"
                    disabled={busy || !recoveryAccountReady}
                    onClick={() => void onResumeClaim(selectedSession)}
                  >
                    {recoveryAccountReady
                      ? "Resume L2 claim"
                      : "Import the matching account to continue"}
                  </button>
                </>
              ) : null}

              <div className="modal-actions recovery-session-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onRemoveSession(selectedSession)}
                >
                  Remove session
                </button>
              </div>
            </div>
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
    </main>
  );
}
