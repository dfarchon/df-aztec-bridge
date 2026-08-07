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
import { type Hex } from "viem";
import {
  connectEvmWalletDetail,
  connectWalletConnect,
  disconnectWalletConnect,
  discoverWallets,
  formatWalletError,
  getFeeJuiceBalance,
  isWalletUserRejection,
  switchWalletChain,
  watchProviderSession,
  LEGACY_WALLET_RDNS,
  type ConnectedWallet,
  type EIP6963ProviderDetail,
  type FeeJuiceBalance,
} from "@df-bridge/browser-sdk";
import type { ImportedAztecAccount } from "../lib/account-import.ts";
import { isBridgeReadyDfPxeAccount } from "../lib/df-pxe-bridge-guard.ts";
import { useNetwork } from "./NetworkProvider.tsx";

const WC_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";

type WalletContextValue = {
  wallet: ConnectedWallet | null;
  ethSessionOk: boolean;
  setEthSessionOk: (ok: boolean) => void;
  dfPxeAccount: ImportedAztecAccount | null;
  setDfPxeAccount: (a: ImportedAztecAccount | null) => void;
  applyDfPxeAccount: (account: ImportedAztecAccount) => void;
  clearDfPxeAccount: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
  feeBalance: FeeJuiceBalance | null;
  balanceError: string | null;
  balanceRefreshing: boolean;
  refreshFeeBalance: (opts?: { spin?: boolean }) => Promise<void>;
  availableWallets: EIP6963ProviderDetail[];
  pickerOpen: boolean;
  wcUri: string | null;
  walletPickerRef: React.RefObject<HTMLDivElement | null>;
  onConnect: () => Promise<void>;
  onConnectWalletConnect: () => Promise<void>;
  connectDetail: (detail: EIP6963ProviderDetail) => Promise<void>;
  closeWalletPicker: () => void;
  onDisconnect: () => Promise<void>;
  addressCopied: boolean;
  copyWalletAddress: () => Promise<void>;
  recipient: string;
  setRecipient: (v: string) => void;
  l2Secret: string;
  setL2Secret: (v: string) => void;
  l2Salt: string;
  setL2Salt: (v: string) => void;
  l2SigningKey: string;
  setL2SigningKey: (v: string) => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider(props: { children: ReactNode }) {
  const { networkMeta } = useNetwork();
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [ethSessionOk, setEthSessionOk] = useState(false);
  const [dfPxeAccount, setDfPxeAccount] = useState<ImportedAztecAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [feeBalance, setFeeBalance] = useState<FeeJuiceBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [l2Secret, setL2Secret] = useState("");
  const [l2Salt, setL2Salt] = useState("");
  const [l2SigningKey, setL2SigningKey] = useState("");
  const walletPickerRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDfPxeAccount = useCallback(() => {
    setDfPxeAccount(null);
    setRecipient("");
    setL2Secret("");
    setL2Salt("0");
    setL2SigningKey("");
  }, []);

  const applyDfPxeAccount = useCallback(
    (account: ImportedAztecAccount) => {
      if (isBridgeReadyDfPxeAccount(account, wallet?.address)) {
        setDfPxeAccount(account);
        setRecipient(account.address);
        setL2Secret(account.secretKey);
        setL2Salt(account.salt);
        setL2SigningKey(account.signingKey ?? "");
      } else {
        setError(
          "Account is not a DF Punk PXE session bound to this connector. Re-import from DF client.",
        );
      }
    },
    [wallet?.address],
  );

  const refreshFeeBalance = useCallback(
    async (opts?: { spin?: boolean }) => {
      if (!wallet || !networkMeta) return;
      const spin = opts?.spin === true;
      const started = Date.now();
      if (spin) {
        setBalanceRefreshing(true);
        setFeeBalance(null);
        setBalanceError(null);
      }
      try {
        setBalanceError(null);
        const bal = await getFeeJuiceBalance({
          tokenAddress: networkMeta.l1Addresses.feeJuice,
          holder: wallet.address,
          chainId: networkMeta.l1ChainId,
          l1RpcUrl: networkMeta.l1RpcUrl,
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
    [wallet, networkMeta],
  );

  useEffect(() => {
    if (!wallet || !networkMeta) {
      setFeeBalance(null);
      return;
    }
    void refreshFeeBalance();
  }, [wallet?.address, wallet?.chainId, networkMeta, refreshFeeBalance]);

  useEffect(() => {
    if (!wallet) return;
    return watchProviderSession(wallet.provider, {
      onAccountsChanged: (accounts) => {
        const next = accounts[0] as Hex | undefined;
        if (!next) {
          setWallet(null);
          setEthSessionOk(false);
          clearDfPxeAccount();
          setFeeBalance(null);
          return;
        }
        setWallet((prev) => (prev ? { ...prev, address: next } : prev));
        setEthSessionOk(false);
        clearDfPxeAccount();
      },
      onChainChanged: (chainId) => {
        setWallet((prev) => (prev ? { ...prev, chainId } : prev));
      },
      onDisconnect: () => {
        setWallet(null);
        setEthSessionOk(false);
        clearDfPxeAccount();
        setFeeBalance(null);
      },
    });
  }, [wallet?.provider, clearDfPxeAccount]);

  useEffect(() => {
    if (!wallet || !networkMeta) return;
    if (wallet.chainId === networkMeta.l1ChainId) return;
    let cancelled = false;
    void (async () => {
      try {
        await switchWalletChain(wallet.provider, networkMeta.l1ChainId);
        if (cancelled) return;
        setWallet((prev) => (prev ? { ...prev, chainId: networkMeta.l1ChainId } : prev));
        setError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        if (isWalletUserRejection(e)) {
          setError(
            `Wallet still on chain ${wallet.chainId}. Switch to ${networkMeta.l1ChainId} to bridge.`,
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
      const trusted = wallets.filter((w) => w.info.rdns !== LEGACY_WALLET_RDNS);
      setAvailableWallets(trusted.length > 0 ? trusted : wallets);
      setPickerOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const closeWalletPicker = useCallback(() => {
    setPickerOpen(false);
    setWcUri(null);
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
      clearDfPxeAccount();
      setFeeBalance(null);
      setBalanceError(null);
      setBusy(false);
    }
  }, [wallet?.rdns, clearDfPxeAccount]);

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

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      ethSessionOk,
      setEthSessionOk,
      dfPxeAccount,
      setDfPxeAccount,
      applyDfPxeAccount,
      clearDfPxeAccount,
      busy,
      setBusy,
      error,
      setError,
      feeBalance,
      balanceError,
      balanceRefreshing,
      refreshFeeBalance,
      availableWallets,
      pickerOpen,
      wcUri,
      walletPickerRef,
      onConnect,
      onConnectWalletConnect,
      connectDetail,
      closeWalletPicker,
      onDisconnect,
      addressCopied,
      copyWalletAddress,
      recipient,
      setRecipient,
      l2Secret,
      setL2Secret,
      l2Salt,
      setL2Salt,
      l2SigningKey,
      setL2SigningKey,
    }),
    [
      wallet,
      ethSessionOk,
      dfPxeAccount,
      applyDfPxeAccount,
      clearDfPxeAccount,
      busy,
      error,
      feeBalance,
      balanceError,
      balanceRefreshing,
      refreshFeeBalance,
      availableWallets,
      pickerOpen,
      wcUri,
      onConnect,
      onConnectWalletConnect,
      connectDetail,
      closeWalletPicker,
      onDisconnect,
      addressCopied,
      copyWalletAddress,
      recipient,
      l2Secret,
      l2Salt,
      l2SigningKey,
    ],
  );

  return <WalletContext.Provider value={value}>{props.children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export { WC_PROJECT_ID };
