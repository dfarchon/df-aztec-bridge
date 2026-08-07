/**
 * Per-network RPC URL overrides persisted as encrypted JSON in the vault.
 * Empty / missing fields fall back to baked-in network defaults.
 */

import { isVaultUnlocked, vaultGetJson, vaultSetJson, VaultLockedError } from "./vault.ts";

export type RpcOverrides = {
  aztecNodeUrl?: string;
  l1RpcUrl?: string;
};

type AllOverrides = Record<string, RpcOverrides>;

async function loadAll(): Promise<AllOverrides> {
  if (!isVaultUnlocked()) return {};
  try {
    const parsed = await vaultGetJson<AllOverrides>("rpc");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

async function saveAll(all: AllOverrides): Promise<void> {
  if (!isVaultUnlocked()) throw new VaultLockedError();
  await vaultSetJson("rpc", all);
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

/** Local / loopback hosts may use http; everything else should be https. */
export function isRpcUrlSchemeAllowed(url: string, { allowHttpLocal = true } = {}): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    if (u.protocol !== "http:") return false;
    if (!allowHttpLocal) return false;
    const host = u.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function validateRpcOverrides(overrides: RpcOverrides): string | null {
  for (const [label, value] of [
    ["Aztec node URL", overrides.aztecNodeUrl],
    ["L1 RPC URL", overrides.l1RpcUrl],
  ] as const) {
    if (!value) continue;
    if (!isRpcUrlSchemeAllowed(value)) {
      return `${label} must use https:// (or http:// only for localhost).`;
    }
  }
  return null;
}

export async function getRpcOverrides(networkId: string): Promise<RpcOverrides> {
  const row = (await loadAll())[networkId];
  if (!row) return {};
  return {
    aztecNodeUrl: clean(row.aztecNodeUrl),
    l1RpcUrl: clean(row.l1RpcUrl),
  };
}

/** Persist overrides for one network. Clears the network entry when both empty. */
export async function setRpcOverrides(
  networkId: string,
  overrides: RpcOverrides,
): Promise<void> {
  const next: RpcOverrides = {
    aztecNodeUrl: clean(overrides.aztecNodeUrl),
    l1RpcUrl: clean(overrides.l1RpcUrl),
  };
  const err = validateRpcOverrides(next);
  if (err) throw new Error(err);
  const all = await loadAll();
  if (!next.aztecNodeUrl && !next.l1RpcUrl) {
    delete all[networkId];
  } else {
    all[networkId] = next;
  }
  await saveAll(all);
}

export function hasRpcOverrides(overrides: RpcOverrides): boolean {
  return !!(overrides.aztecNodeUrl || overrides.l1RpcUrl);
}

export const RPC_OVERRIDE_WARNING =
  "Custom RPC URLs can expose metadata to a malicious operator. Prefer HTTPS and verify the host before signing.";
