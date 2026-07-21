import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { parseUnits, type Hex } from "viem";
import {
  bridgeFromConnectedWallet,
  connectEvmWalletDetail,
  connectWalletConnect,
  discoverWallets,
  formatWalletError,
  getFeeJuiceBalance,
  isWalletUserRejection,
  switchWalletChain,
  watchProviderSession,
  type BridgeProgressPhase,
  type ClaimCredentials,
  type ConnectedWallet,
  type EIP6963ProviderDetail,
  type FeeJuiceBalance,
  type L1BridgeBackend,
} from "@df-bridge/browser-sdk";
import {
  DEFAULT_NETWORK_ID,
  getNetwork,
  listNetworkIds,
  type WebNetworkConfig,
} from "./config/networks.js";
import { readAccountFile, type ImportedAztecAccount } from "./lib/account-import.js";
import {
  getRpcOverrides,
  hasRpcOverrides,
  setRpcOverrides,
  type RpcOverrides,
} from "./lib/rpc-overrides.js";

type NetworkMeta = WebNetworkConfig;

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";
/** Build-time: include / use in-browser PXE claim (heavy chunk). */
const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM === "true";

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function withRpcOverrides(networkId: string, overrides: RpcOverrides): NetworkMeta {
  const base = getNetwork(networkId);
  return {
    ...base,
    aztecNodeUrl: overrides.aztecNodeUrl?.trim() || base.aztecNodeUrl,
    l1RpcUrl: overrides.l1RpcUrl?.trim() || base.l1RpcUrl,
  };
}

export function App() {
  const [networks] = useState(() => listNetworkIds());
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK_ID);
  /** UI default portal; selector disabled for now. */
  const [l1Backend, setL1Backend] = useState<L1BridgeBackend>("portal");
  const [rpcOverrides, setRpcOverridesState] = useState<RpcOverrides>(() =>
    getRpcOverrides(DEFAULT_NETWORK_ID),
  );
  const [networkMeta, setNetworkMeta] = useState<NetworkMeta | null>(() =>
    withRpcOverrides(DEFAULT_NETWORK_ID, getRpcOverrides(DEFAULT_NETWORK_ID)),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftAztecUrl, setDraftAztecUrl] = useState("");
  const [draftL1RpcUrl, setDraftL1RpcUrl] = useState("");
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amountFj, setAmountFj] = useState("1000");
  /** When false: L1 bridge only — no L2 secret needed. */
  const [autoClaim, setAutoClaim] = useState(false);
  const [l2Secret, setL2Secret] = useState("");
  const [l2Salt, setL2Salt] = useState("");
  const [showL2Secret, setShowL2Secret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgePhase, setBridgePhase] = useState<string | null>(null);
  const [l1TxHash, setL1TxHash] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ClaimCredentials | null>(null);
  const [claimJobId, setClaimJobId] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState<string | null>(null);
  const [l2TxHash, setL2TxHash] = useState<string | null>(null);
  const [feeBalance, setFeeBalance] = useState<FeeJuiceBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [importedAccounts, setImportedAccounts] = useState<ImportedAztecAccount[]>([]);
  const [importedIndex, setImportedIndex] = useState(0);
  const [importName, setImportName] = useState<string | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);

  const applyImportedAccount = useCallback((account: ImportedAztecAccount) => {
    setRecipient(account.address);
    setL2Secret(account.secretKey);
    setL2Salt(account.salt);
    setAutoClaim(true);
  }, []);

  const onAccountFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      try {
        if (!file.name.toLowerCase().endsWith(".json") && file.type && file.type !== "application/json") {
          throw new Error("Please upload a .json account file");
        }
        const accounts = await readAccountFile(file);
        setImportedAccounts(accounts);
        setImportedIndex(0);
        setImportName(file.name);
        applyImportedAccount(accounts[0]!);
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

  const startClaimJob = useCallback(
    async (creds: ClaimCredentials, secret: string, salt?: string) => {
      if (BROWSER_CLAIM) {
        if (!networkMeta?.aztecNodeUrl) {
          throw new Error("Network meta missing aztecNodeUrl for browser claim.");
        }
        setClaimJobId("browser");
        setClaimStatus("running");
        setL2TxHash(null);
        setBridgePhase("Loading browser PXE (first time may download a large chunk)…");
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { waitAndClaimInBrowser } = await loadBrowserClaim();
        const { l2TxHash: hash } = await waitAndClaimInBrowser({
          aztecNodeUrl: networkMeta.aztecNodeUrl,
          networkId: networkMeta.id,
          credentials: creds,
          l2SecretKey: secret,
          salt,
          onProgress: (phase, detail) => {
            setClaimStatus(phase);
            if (detail) setBridgePhase(`[${phase}] ${detail}`);
            else setBridgePhase(phase);
          },
        });
        setL2TxHash(hash);
        setClaimStatus("succeeded");
        setBridgePhase("L2 claim complete (browser)");
        return;
      }

      const res = await fetch(`${API_BASE}/v1/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: networkId,
          credentials: creds,
          callerAddress: creds.recipient,
          l2SecretKey: secret,
          ...(salt?.trim() ? { salt: salt.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Claim request failed");
      setClaimJobId(body.jobId ?? null);
      setClaimStatus("queued");
      setL2TxHash(null);
    },
    [networkId, networkMeta],
  );

  const onBridge = useCallback(async () => {
    if (!wallet || !networkMeta) return;
    if (autoClaim && !l2Secret.trim()) {
      setError("Auto-claim is on — enter the Aztec L2 secret for that recipient account.");
      return;
    }

    setBusy(true);
    setBridgePhase(null);
    setError(null);
    setL1TxHash(null);
    setCredentials(null);
    setClaimJobId(null);
    setClaimStatus(null);
    setL2TxHash(null);
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
        amount: parseUnits(amountFj, 18),
        mint,
        backend,
        l1RpcUrl: networkMeta.l1RpcUrl,
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
        },
      });
      setL1TxHash(result.l1TxHash);
      setCredentials(result.credentials);
      setBridgePhase("L1 bridge complete");

      if (autoClaim) {
        setBridgePhase("Starting L2 claim job…");
        await startClaimJob(result.credentials, l2Secret.trim(), l2Salt);
        setBridgePhase("L2 claim job queued");
      }
    } catch (e: unknown) {
      setError(formatWalletError(e));
      setBridgePhase(null);
    } finally {
      setBusy(false);
    }
  }, [wallet, networkMeta, recipient, amountFj, autoClaim, l2Secret, l2Salt, l1Backend, startClaimJob]);

  const onClaimViaApi = useCallback(async () => {
    if (!credentials) return;
    if (!l2Secret.trim()) {
      setError("Enter the Aztec L2 secret to claim.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startClaimJob(credentials, l2Secret.trim(), l2Salt);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [credentials, l2Secret, l2Salt, startClaimJob]);

  useEffect(() => {
    if (!claimJobId || claimJobId === "browser") return;
    const t = setInterval(() => {
      void fetch(`${API_BASE}/v1/jobs/${claimJobId}`)
        .then((r) => r.json())
        .then((job: { status: string; error?: string; result?: { l2TxHash?: string } }) => {
          setClaimStatus(job.status);
          if (job.status === "failed") setError(job.error ?? "Claim failed");
          if (job.status === "succeeded") {
            if (job.result?.l2TxHash) setL2TxHash(job.result.l2TxHash);
            clearInterval(t);
          }
        });
    }, 3000);
    return () => clearInterval(t);
  }, [claimJobId]);

  const canBridge =
    !!wallet && !!recipient.trim() && !!networkMeta && (!autoClaim || !!l2Secret.trim());

  return (
    <main>
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
              跨链从 L1 扣下方余额。
              {networkMeta?.l1Addresses.feeAssetHandler
                ? " Testnet 可用 faucet 铸造，可不持有代币。"
                : " 主网需自备 L1 AZTEC + ETH gas。"}
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
                  {balanceError ? "查询失败" : "查询中…"}
                </span>
              )}
              <button
                type="button"
                className={`icon-btn${balanceRefreshing ? " spinning" : ""}`}
                aria-label="刷新余额"
                title="刷新余额"
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
          <p className="hint">Browser extensions (EIP-6963) or mobile QR (WalletConnect).</p>

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

      <div className="card account-import">
        <strong>Import Aztec account</strong>
        <p className="hint">
          Upload <span className="mono">dfpunk-account-*.json</span> with{" "}
          <span className="mono">address / secretKey / salt</span> (and optional signingKey). Fills
          the form below.
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
            void onAccountFile(f);
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
                void onAccountFile(f);
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
                setImportedIndex(i);
                const acc = importedAccounts[i];
                if (acc) applyImportedAccount(acc);
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
        <input value={amountFj} onChange={(e) => setAmountFj(e.target.value)} inputMode="decimal" />
      </label>

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
        <div className="card claim-opts">
          <p className="hint">
            Secret is only used server-side for wait + claim. Prefer CLI claim if you do not want to
            paste it into the browser.
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
                aria-label={showL2Secret ? "隐藏 L2 secret" : "显示 L2 secret"}
                title={showL2Secret ? "隐藏" : "显示"}
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
      ) : (
        <p className="hint">Auto-claim off — after L1 succeeds you can download credentials and claim via CLI later.</p>
      )}

      <button type="button" onClick={() => void onBridge()} disabled={busy || !canBridge}>
        {autoClaim ? "Bridge + auto claim" : "Bridge via wallet (L1 only)"}
      </button>

      {bridgePhase ? (
        <p className={`bridge-phase${busy ? " active" : ""}`}>
          {busy ? "⏳ " : "✓ "}
          {bridgePhase}
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {l1TxHash ? (
        <div className="card">
          <strong>L1 transaction</strong>
          <p className="mono">{l1TxHash}</p>
        </div>
      ) : null}

      {credentials ? (
        <div className="card">
          <strong>Claim credentials</strong>
          <p className="hint">Back these up — refresh will lose them if you do not download.</p>
          <p className="mono">{JSON.stringify(credentials, null, 2)}</p>
          <button
            type="button"
            className="ghost"
            onClick={() =>
              downloadJson(`claim-${credentials.recipient.slice(0, 10)}.json`, {
                recipient: credentials.recipient,
                credentials,
              })
            }
          >
            Download credentials JSON
          </button>

          {!autoClaim ? (
            <>
              <p className="hint">Optional: claim now in the browser (requires L2 secret).</p>
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
                    aria-label={showL2Secret ? "隐藏 L2 secret" : "显示 L2 secret"}
                    title={showL2Secret ? "隐藏" : "显示"}
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
                Salt (optional)
                <input
                  value={l2Salt}
                  onChange={(e) => setL2Salt(e.target.value)}
                  placeholder="leave empty for default 0"
                  autoComplete="off"
                />
              </label>
              <button type="button" onClick={() => void onClaimViaApi()} disabled={busy || !l2Secret.trim()}>
                L2 wait + claim (via API)
              </button>
            </>
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
    </main>
  );
}
