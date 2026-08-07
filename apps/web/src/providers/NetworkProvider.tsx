import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_NETWORK_ID,
  getNetwork,
  listNetworkIds,
  type WebNetworkConfig,
} from "../config/networks.ts";
import {
  getRpcOverrides,
  setRpcOverrides as persistRpcOverrides,
  type RpcOverrides,
} from "../lib/rpc-overrides.ts";
import type { L1BridgeBackend } from "@df-bridge/browser-sdk";
import { isVaultUnlocked, subscribeVault } from "../lib/vault.ts";
import { useVault } from "./VaultProvider.tsx";
import { pushDappLog } from "../lib/dapp-log.ts";

export type NetworkMeta = WebNetworkConfig;

type NetworkContextValue = {
  networks: string[];
  networkId: string;
  setNetworkId: (id: string) => void;
  networkMeta: NetworkMeta | null;
  l1Backend: L1BridgeBackend;
  setL1Backend: (v: L1BridgeBackend) => void;
  rpcOverrides: RpcOverrides;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  draftAztecUrl: string;
  setDraftAztecUrl: (v: string) => void;
  draftL1RpcUrl: string;
  setDraftL1RpcUrl: (v: string) => void;
  saveSettings: () => void;
  resetSettingsDraft: () => void;
  settingsError: string | null;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

function withRpcOverrides(networkId: string, overrides: RpcOverrides): NetworkMeta {
  const base = getNetwork(networkId);
  return {
    ...base,
    aztecNodeUrl: overrides.aztecNodeUrl?.trim() || base.aztecNodeUrl,
    l1RpcUrl: overrides.l1RpcUrl?.trim() || base.l1RpcUrl,
  };
}

export function NetworkProvider(props: { children: ReactNode }) {
  const { ensureUnlocked } = useVault();
  const [networks] = useState(() => listNetworkIds());
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK_ID);
  const [l1Backend, setL1Backend] = useState<L1BridgeBackend>("portal");
  const [rpcOverrides, setRpcOverridesState] = useState<RpcOverrides>({});
  const [networkMeta, setNetworkMeta] = useState<NetworkMeta | null>(() =>
    withRpcOverrides(DEFAULT_NETWORK_ID, {}),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftAztecUrl, setDraftAztecUrl] = useState("");
  const [draftL1RpcUrl, setDraftL1RpcUrl] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [vaultTick, setVaultTick] = useState(0);

  useEffect(() => subscribeVault(() => setVaultTick((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const overrides = isVaultUnlocked()
          ? await getRpcOverrides(networkId)
          : {};
        if (cancelled) return;
        setRpcOverridesState(overrides);
        setNetworkMeta(withRpcOverrides(networkId, overrides));
        setSettingsError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setNetworkMeta(withRpcOverrides(networkId, {}));
        setSettingsError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkId, vaultTick]);

  const openSettings = useCallback(() => {
    void (async () => {
      const overrides = isVaultUnlocked() ? await getRpcOverrides(networkId) : {};
      const defaults = getNetwork(networkId);
      setDraftAztecUrl(overrides.aztecNodeUrl ?? defaults.aztecNodeUrl);
      setDraftL1RpcUrl(overrides.l1RpcUrl ?? defaults.l1RpcUrl);
      setSettingsOpen(true);
      pushDappLog({
        kind: "info",
        title: "RPC settings opened",
        detail:
          "Pick an Aztec node from Chainlist options or edit the URL. Saves into the vault when unlocked.",
        ttlMs: 8_000,
      });
    })();
  }, [networkId]);

  const saveSettings = useCallback(() => {
    void (async () => {
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
      try {
        const ok = await ensureUnlocked("secrets");
        if (!ok) {
          setSettingsError("Unlock the vault to save RPC overrides.");
          return;
        }
        await persistRpcOverrides(networkId, next);
        setRpcOverridesState(next);
        setNetworkMeta(withRpcOverrides(networkId, next));
        setSettingsOpen(false);
        setSettingsError(null);
        pushDappLog({
          kind: "tx",
          title: "RPC overrides saved",
          detail: next.aztecNodeUrl || next.l1RpcUrl
            ? `Aztec: ${next.aztecNodeUrl ?? "(default)"} · L1: ${next.l1RpcUrl ?? "(default)"}`
            : "Cleared — using network defaults.",
          ttlMs: 10_000,
        });
      } catch (e: unknown) {
        setSettingsError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [networkId, draftAztecUrl, draftL1RpcUrl, ensureUnlocked]);

  const resetSettingsDraft = useCallback(() => {
    const defaults = getNetwork(networkId);
    setDraftAztecUrl(defaults.aztecNodeUrl);
    setDraftL1RpcUrl(defaults.l1RpcUrl);
  }, [networkId]);

  const value = useMemo<NetworkContextValue>(
    () => ({
      networks,
      networkId,
      setNetworkId,
      networkMeta,
      l1Backend,
      setL1Backend,
      rpcOverrides,
      settingsOpen,
      openSettings,
      closeSettings: () => setSettingsOpen(false),
      draftAztecUrl,
      setDraftAztecUrl,
      draftL1RpcUrl,
      setDraftL1RpcUrl,
      saveSettings,
      resetSettingsDraft,
      settingsError,
    }),
    [
      networks,
      networkId,
      networkMeta,
      l1Backend,
      rpcOverrides,
      settingsOpen,
      openSettings,
      draftAztecUrl,
      draftL1RpcUrl,
      saveSettings,
      resetSettingsDraft,
      settingsError,
    ],
  );

  return <NetworkContext.Provider value={value}>{props.children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
}
