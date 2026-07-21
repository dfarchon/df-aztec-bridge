/**
 * Per-network RPC URL overrides persisted in localStorage.
 * Empty / missing fields fall back to baked-in network defaults.
 */

export type RpcOverrides = {
  aztecNodeUrl?: string;
  l1RpcUrl?: string;
};

const STORAGE_KEY = "df-bridge:rpc-overrides";

type AllOverrides = Record<string, RpcOverrides>;

function loadAll(): AllOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AllOverrides;
  } catch {
    return {};
  }
}

function saveAll(all: AllOverrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

export function getRpcOverrides(networkId: string): RpcOverrides {
  const row = loadAll()[networkId];
  if (!row) return {};
  return {
    aztecNodeUrl: clean(row.aztecNodeUrl),
    l1RpcUrl: clean(row.l1RpcUrl),
  };
}

/** Persist overrides for one network. Clears the network entry when both empty. */
export function setRpcOverrides(networkId: string, overrides: RpcOverrides): void {
  const next: RpcOverrides = {
    aztecNodeUrl: clean(overrides.aztecNodeUrl),
    l1RpcUrl: clean(overrides.l1RpcUrl),
  };
  const all = loadAll();
  if (!next.aztecNodeUrl && !next.l1RpcUrl) {
    delete all[networkId];
  } else {
    all[networkId] = next;
  }
  saveAll(all);
}

export function hasRpcOverrides(overrides: RpcOverrides): boolean {
  return !!(overrides.aztecNodeUrl || overrides.l1RpcUrl);
}
