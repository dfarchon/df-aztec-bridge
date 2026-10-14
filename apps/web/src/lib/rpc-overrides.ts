/**
 * Per-network Aztec node URL overrides persisted as encrypted JSON in the vault.
 * Empty / missing fields fall back to baked-in network defaults.
 * L1 RPC is always the network preset (not user-overridable).
 *
 * Custom hosts must be loopback or on OFFICIAL_HTTPS_HOST_ALLOWLIST — arbitrary
 * https:// (including random *.drpc.* subdomains) is rejected.
 */

import { isOfficialHttpsUrl } from "./official-links.ts";
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

function isLoopbackRpcUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Allowlisted official HTTPS or local http(s) loopback only. */
export function isAllowedRpcOverrideUrl(url: string): boolean {
  if (!isRpcUrlSchemeAllowed(url)) return false;
  if (isLoopbackRpcUrl(url)) return true;
  return isOfficialHttpsUrl(url);
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
      return `${label} host is not on the official allowlist (or localhost). Arbitrary RPCs (including unlisted *.drpc.*) are blocked.`;
    }
  }
  return null;
}

export async function getRpcOverrides(networkId: string): Promise<RpcOverrides> {
  const row = (await loadAll())[networkId];
  if (!row) return {};
  return {
    aztecNodeUrl: clean(row.aztecNodeUrl),
  };
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
  "Custom RPC URLs must be localhost or on the official host allowlist. Prefer baked-in defaults; malicious RPCs can observe metadata.";
