/**
 * Per-network Aztec node URL overrides persisted as encrypted JSON in the vault.
 * Empty / missing fields fall back to baked-in network defaults.
 * L1 RPC is always the network preset (not user-overridable).
 *
 * Overrides must be an exact pinned public RPC (no path or query) or loopback.
 * `lb.drpc.live/<path>` is rejected: that host is multi-tenant.
 */

import { isLoopbackRpcUrl, isPinnedPublicRpcUrl } from "./official-links.ts";
import { isVaultUnlocked, vaultGetJson, vaultSetJson, VaultLockedError } from "./vault.ts";

export type RpcOverrides = {
  aztecNodeUrl?: string;
  /** Ignored leftover from older vault blobs. L1 always uses the network preset. */
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

/** Pinned public HTTPS RPC, or local http(s) loopback. No path keys. */
export function isAllowedRpcOverrideUrl(url: string): boolean {
  return isPinnedPublicRpcUrl(url) || isLoopbackRpcUrl(url);
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
    if (!isAllowedRpcOverrideUrl(value)) {
      return `${label} must be a pinned public RPC with no path, or localhost. Multi-tenant hosts (lb.drpc.live) and arbitrary paths are blocked.`;
    }
  }
  return null;
}

export async function getRpcOverrides(networkId: string): Promise<RpcOverrides> {
  const row = (await loadAll())[networkId];
  if (!row) return {};
  const next: RpcOverrides = {
    aztecNodeUrl: clean(row.aztecNodeUrl),
  };
  // Drop legacy / tampered vault blobs that no longer pass the allowlist.
  if (validateRpcOverrides(next)) return {};
  return next;
}

/** Persist Aztec node override for one network. Clears the network entry when empty. */
export async function setRpcOverrides(
  networkId: string,
  overrides: RpcOverrides,
): Promise<void> {
  const next: RpcOverrides = {
    aztecNodeUrl: clean(overrides.aztecNodeUrl),
  };
  const err = validateRpcOverrides(next);
  if (err) throw new Error(err);
  const all = await loadAll();
  if (!next.aztecNodeUrl) {
    delete all[networkId];
  } else {
    all[networkId] = next;
  }
  await saveAll(all);
}

export function hasRpcOverrides(overrides: RpcOverrides): boolean {
  return !!overrides.aztecNodeUrl;
}

export const RPC_OVERRIDE_WARNING =
  "Custom RPC URLs must be localhost or an exact public endpoint with no path. Prefer baked-in defaults; a different node can observe metadata.";
