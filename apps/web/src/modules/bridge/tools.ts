import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import {
  BridgeStorageError,
  getActiveSession,
  listIncompleteSessions,
  type BridgeSessionEntry,
} from "../../lib/bridge-session.ts";
import { VaultLockedError } from "../../lib/vault.ts";

export async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
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

/** Prefer the typed signing key; fall back to the imported DF Punk account when it is the claim recipient. */
export function resolveClaimSigningKey(
  recipient: string,
  typed: string,
  account: ImportedAztecAccount | null,
): string | undefined {
  const explicit = typed.trim();
  if (explicit) return explicit;
  if (
    account?.signingKey?.trim() &&
    account.address.toLowerCase() === recipient.trim().toLowerCase()
  ) {
    return account.signingKey.trim();
  }
  return undefined;
}

export function storageErrorMessage(e: unknown): string {
  if (e instanceof BridgeStorageError) return e.message;
  if (e instanceof VaultLockedError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export async function loadInitialSession(networkId: string): Promise<BridgeSessionEntry | null> {
  try {
    return (await getActiveSession(networkId)) ?? (await listIncompleteSessions(networkId))[0] ?? null;
  } catch {
    return null;
  }
}

export async function loadInitialSessions(networkId: string): Promise<BridgeSessionEntry[]> {
  try {
    return await listIncompleteSessions(networkId);
  } catch {
    return [];
  }
}
