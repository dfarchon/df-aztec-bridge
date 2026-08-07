import type { ClaimCredentials, PendingBridge } from "@df-bridge/browser-sdk";
import {
  isVaultUnlocked,
  vaultGetJson,
  vaultSetJson,
  VaultLockedError,
} from "./vault.ts";

const V1_STORAGE_KEY = "df_aztec_bridge_session";
const V2_STORAGE_KEY = "df_aztec_bridge_sessions";

const storageKey = (networkId: string) => `${V2_STORAGE_KEY}:${networkId}`;
const vaultDocId = (networkId: string) => `bridge:${networkId}`;

export type ClaimPhase =
  | "l1-pending"
  | "ready-to-claim"
  | "claiming"
  | "claim-sent"
  | "failed";

export type ClaimChannel = "browser" | "api";

export interface BridgeSessionEntry {
  l1TxHash: string;
  createdAt: number;
  updatedAt: number;
  phase: ClaimPhase;
  networkId: string;
  recipient: string;
  claimAmount: string;
  pending?: PendingBridge;
  credentials?: ClaimCredentials;
  claimJobId?: string;
  claimChannel?: ClaimChannel;
  l2TxHash?: string;
  lastError?: string;
}

export interface BridgeSessionStoreV2 {
  version: 2;
  networkId: string;
  updatedAt: number;
  activeL1TxHash: string | null;
  sessions: Record<string, BridgeSessionEntry>;
}

/** @deprecated v1 single-session shape, kept only for migration. */
interface BridgeSessionV1 {
  version: 1;
  networkId: string;
  timestamp: number;
  l1TxHash: string;
  claimPhase?: "l1-pending" | "ready-to-claim" | "claiming";
  pending?: PendingBridge;
  credentials?: ClaimCredentials;
  claimJobId?: string;
}

export class BridgeStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeStorageError";
  }
}

const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const HEX_ANY = /^0x[0-9a-fA-F]+$/;

export function normalizeL1TxHash(hash: string): string {
  return hash.trim().toLowerCase();
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX64.test(value);
}

function isHexField(value: unknown): value is string {
  return typeof value === "string" && HEX_ANY.test(value.trim());
}

export function validatePendingBridge(value: unknown, expectedL1?: string): PendingBridge {
  if (!value || typeof value !== "object") {
    throw new BridgeStorageError("Invalid pending bridge payload.");
  }
  const pending = value as Record<string, unknown>;
  if (!isHex64(pending.l1TxHash)) {
    throw new BridgeStorageError("Pending bridge is missing a valid L1 tx hash.");
  }
  if (!isHex64(pending.claimSecret) || !isHex64(pending.claimSecretHash)) {
    throw new BridgeStorageError("Pending bridge secrets are invalid.");
  }
  if (typeof pending.claimAmount !== "string" || !/^\d+$/.test(pending.claimAmount)) {
    throw new BridgeStorageError("Pending bridge amount is invalid.");
  }
  if (!isHexField(pending.recipient)) {
    throw new BridgeStorageError("Pending bridge recipient is invalid.");
  }
  if (expectedL1 && normalizeL1TxHash(pending.l1TxHash) !== normalizeL1TxHash(expectedL1)) {
    throw new BridgeStorageError("Pending bridge L1 tx hash mismatch.");
  }
  return {
    l1TxHash: pending.l1TxHash as PendingBridge["l1TxHash"],
    claimSecret: pending.claimSecret as PendingBridge["claimSecret"],
    claimSecretHash: pending.claimSecretHash as PendingBridge["claimSecretHash"],
    claimAmount: pending.claimAmount,
    recipient: pending.recipient,
  };
}

export function validateClaimCredentials(value: unknown): ClaimCredentials {
  if (!value || typeof value !== "object") {
    throw new BridgeStorageError("Invalid claim credentials payload.");
  }
  const credentials = value as Record<string, unknown>;
  for (const key of [
    "claimSecret",
    "claimSecretHash",
    "messageHash",
    "messageLeafIndex",
    "claimAmount",
    "recipient",
  ] as const) {
    if (typeof credentials[key] !== "string" || !String(credentials[key]).trim()) {
      throw new BridgeStorageError(`Claim credentials missing "${key}".`);
    }
  }
  if (!isHex64(credentials.claimSecret) || !isHex64(credentials.claimSecretHash)) {
    throw new BridgeStorageError("Claim credentials secrets are invalid.");
  }
  if (!isHex64(credentials.messageHash)) {
    throw new BridgeStorageError("Claim credentials message hash is invalid.");
  }
  if (!/^\d+$/.test(credentials.messageLeafIndex as string)) {
    throw new BridgeStorageError("Claim credentials message leaf index is invalid.");
  }
  if (!/^\d+$/.test(credentials.claimAmount as string)) {
    throw new BridgeStorageError("Claim credentials amount is invalid.");
  }
  if (!isHexField(credentials.recipient)) {
    throw new BridgeStorageError("Claim credentials recipient is invalid.");
  }
  return {
    claimSecret: credentials.claimSecret as string,
    claimSecretHash: credentials.claimSecretHash as string,
    messageHash: credentials.messageHash as string,
    messageLeafIndex: credentials.messageLeafIndex as string,
    claimAmount: credentials.claimAmount as string,
    recipient: credentials.recipient as string,
  };
}

function assertPhasePayload(entry: BridgeSessionEntry) {
  switch (entry.phase) {
    case "l1-pending":
      if (!entry.pending || entry.credentials) {
        throw new BridgeStorageError("l1-pending sessions must include pending data only.");
      }
      break;
    case "ready-to-claim":
    case "claiming":
    case "claim-sent":
    case "failed":
      if (!entry.credentials) {
        throw new BridgeStorageError(`${entry.phase} sessions require claim credentials.`);
      }
      if (entry.phase === "claim-sent" && !entry.l2TxHash) {
        throw new BridgeStorageError("claim-sent sessions require an L2 tx hash.");
      }
      break;
    default: {
      const _exhaustive: never = entry.phase;
      throw new BridgeStorageError(`Unknown claim phase: ${_exhaustive}`);
    }
  }
}

export function validateSessionEntry(value: unknown): BridgeSessionEntry {
  if (!value || typeof value !== "object") {
    throw new BridgeStorageError("Invalid session entry.");
  }
  const entry = value as Record<string, unknown>;
  if (!isHex64(entry.l1TxHash)) {
    throw new BridgeStorageError("Session entry is missing a valid L1 tx hash.");
  }
  if (typeof entry.networkId !== "string" || !entry.networkId.trim()) {
    throw new BridgeStorageError("Session entry is missing networkId.");
  }
  if (typeof entry.createdAt !== "number" || typeof entry.updatedAt !== "number") {
    throw new BridgeStorageError("Session entry timestamps are invalid.");
  }
  if (
    entry.phase !== "l1-pending" &&
    entry.phase !== "ready-to-claim" &&
    entry.phase !== "claiming" &&
    entry.phase !== "claim-sent" &&
    entry.phase !== "failed"
  ) {
    throw new BridgeStorageError("Session entry phase is invalid.");
  }
  if (!isHexField(entry.recipient)) {
    throw new BridgeStorageError("Session entry recipient is invalid.");
  }
  if (typeof entry.claimAmount !== "string" || !/^\d+$/.test(entry.claimAmount)) {
    throw new BridgeStorageError("Session entry amount is invalid.");
  }

  const pending =
    entry.pending === undefined
      ? undefined
      : validatePendingBridge(entry.pending, entry.l1TxHash as string);
  const credentials =
    entry.credentials === undefined ? undefined : validateClaimCredentials(entry.credentials);

  const normalized: BridgeSessionEntry = {
    l1TxHash: entry.l1TxHash as string,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    phase: entry.phase,
    networkId: entry.networkId,
    recipient: entry.recipient,
    claimAmount: entry.claimAmount,
    ...(pending ? { pending } : {}),
    ...(credentials ? { credentials } : {}),
    ...(typeof entry.claimJobId === "string" ? { claimJobId: entry.claimJobId } : {}),
    ...(entry.claimChannel === "browser" || entry.claimChannel === "api"
      ? { claimChannel: entry.claimChannel }
      : {}),
    ...(typeof entry.l2TxHash === "string" ? { l2TxHash: entry.l2TxHash } : {}),
    ...(typeof entry.lastError === "string" ? { lastError: entry.lastError } : {}),
  };
  assertPhasePayload(normalized);
  return normalized;
}

function emptyStore(networkId: string): BridgeSessionStoreV2 {
  return {
    version: 2,
    networkId,
    updatedAt: Date.now(),
    activeL1TxHash: null,
    sessions: {},
  };
}

function isBridgeSessionV1(value: unknown): value is BridgeSessionV1 {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    session.version === 1 &&
    typeof session.networkId === "string" &&
    typeof session.timestamp === "number" &&
    typeof session.l1TxHash === "string" &&
    (typeof session.pending === "object" || typeof session.credentials === "object")
  );
}

function migrateV1(session: BridgeSessionV1): BridgeSessionStoreV2 {
  const now = Date.now();
  const phase: ClaimPhase =
    session.claimPhase ??
    (session.credentials ? "ready-to-claim" : "l1-pending");
  const recipient =
    session.credentials?.recipient ??
    session.pending?.recipient ??
    "0x0";
  const claimAmount =
    session.credentials?.claimAmount ??
    session.pending?.claimAmount ??
    "0";
  const entry = validateSessionEntry({
    l1TxHash: session.l1TxHash,
    createdAt: session.timestamp,
    updatedAt: now,
    phase,
    networkId: session.networkId,
    recipient,
    claimAmount,
    ...(session.pending ? { pending: session.pending } : {}),
    ...(session.credentials ? { credentials: session.credentials } : {}),
    ...(session.claimJobId ? { claimJobId: session.claimJobId } : {}),
    ...(session.claimJobId && session.claimJobId !== "browser"
      ? { claimChannel: "api" }
      : session.claimPhase === "claiming"
        ? { claimChannel: "browser" }
        : {}),
  });
  const key = normalizeL1TxHash(entry.l1TxHash);
  return {
    version: 2,
    networkId: session.networkId,
    updatedAt: now,
    activeL1TxHash: key,
    sessions: { [key]: entry },
  };
}

function validateStore(value: unknown, networkId: string): BridgeSessionStoreV2 {
  if (!value || typeof value !== "object") {
    throw new BridgeStorageError("Invalid recovery store.");
  }
  const store = value as Record<string, unknown>;
  if (store.version !== 2 || typeof store.networkId !== "string") {
    throw new BridgeStorageError("Unsupported recovery store version.");
  }
  if (store.networkId !== networkId) {
    throw new BridgeStorageError("Recovery store network mismatch.");
  }
  if (typeof store.updatedAt !== "number") {
    throw new BridgeStorageError("Recovery store timestamp is invalid.");
  }
  if (
    store.activeL1TxHash !== null &&
    (typeof store.activeL1TxHash !== "string" || !isHex64(store.activeL1TxHash))
  ) {
    throw new BridgeStorageError("Recovery store active session pointer is invalid.");
  }
  if (!store.sessions || typeof store.sessions !== "object") {
    throw new BridgeStorageError("Recovery store sessions map is invalid.");
  }

  const sessions: Record<string, BridgeSessionEntry> = {};
  for (const [key, rawEntry] of Object.entries(store.sessions as Record<string, unknown>)) {
    try {
      const entry = validateSessionEntry(rawEntry);
      sessions[normalizeL1TxHash(key)] = entry;
    } catch (error) {
      console.warn("[bridge] Dropping corrupt recovery session", key, error);
    }
  }

  const active =
    typeof store.activeL1TxHash === "string" && sessions[normalizeL1TxHash(store.activeL1TxHash)]
      ? normalizeL1TxHash(store.activeL1TxHash)
      : Object.keys(sessions)[0] ?? null;

  return {
    version: 2,
    networkId,
    updatedAt: store.updatedAt,
    activeL1TxHash: active,
    sessions,
  };
}

function readLegacyLocalStore(networkId: string): { raw: unknown; sourceKey: string } | null {
  if (typeof localStorage === "undefined") return null;
  const scopedKey = storageKey(networkId);
  const scoped = localStorage.getItem(scopedKey);
  if (scoped) return { raw: JSON.parse(scoped) as unknown, sourceKey: scopedKey };

  for (const sourceKey of [V2_STORAGE_KEY, V1_STORAGE_KEY]) {
    const legacy = localStorage.getItem(sourceKey);
    if (!legacy) continue;
    const raw = JSON.parse(legacy) as unknown;
    if (
      raw &&
      typeof raw === "object" &&
      (raw as Record<string, unknown>).networkId === networkId
    ) {
      return { raw, sourceKey };
    }
  }
  return null;
}

async function writeStore(store: BridgeSessionStoreV2): Promise<void> {
  if (!isVaultUnlocked()) {
    throw new VaultLockedError(
      "Unlock the vault to save bridge recovery sessions.",
    );
  }
  await vaultSetJson(vaultDocId(store.networkId), store);
}

export async function assertBridgeStorageReady(): Promise<void> {
  if (!isVaultUnlocked()) {
    throw new BridgeStorageError(
      "Vault is locked — unlock with your password (and connected PXE signingKey) before saving recovery data.",
    );
  }
  try {
    const probeStore: BridgeSessionStoreV2 = {
      version: 2,
      networkId: "__probe__",
      updatedAt: Date.now(),
      activeL1TxHash: null,
      sessions: {},
    };
    await vaultSetJson("bridge:__probe__", probeStore);
    const roundTrip = await vaultGetJson<BridgeSessionStoreV2>("bridge:__probe__");
    if (!roundTrip || typeof roundTrip !== "object") {
      throw new BridgeStorageError("Vault storage round-trip verification failed.");
    }
  } catch (error) {
    if (error instanceof BridgeStorageError || error instanceof VaultLockedError) throw error;
    throw new BridgeStorageError(
      "Vault storage is blocked or unavailable — claim recovery will not work.",
    );
  }
}

export async function loadSessionStore(networkId: string): Promise<BridgeSessionStoreV2> {
  try {
    if (isVaultUnlocked()) {
      const fromVault = await vaultGetJson<unknown>(vaultDocId(networkId));
      if (fromVault) {
        if (isBridgeSessionV1(fromVault)) {
          const migrated = migrateV1(fromVault);
          await writeStore(migrated);
          return migrated;
        }
        try {
          return validateStore(fromVault, networkId);
        } catch (error) {
          console.warn("[bridge] Clearing invalid vault recovery store:", error);
          return emptyStore(networkId);
        }
      }
    }

    // One-shot read of leftover plaintext LS (pre-migrate); do not write LS.
    const stored = readLegacyLocalStore(networkId);
    if (!stored) return emptyStore(networkId);
    const { raw } = stored;

    if (isBridgeSessionV1(raw)) {
      const migrated = migrateV1(raw);
      if (isVaultUnlocked()) await writeStore(migrated);
      return migrated;
    }

    try {
      const validated = validateStore(raw, networkId);
      if (isVaultUnlocked()) await writeStore(validated);
      return validated;
    } catch (error) {
      console.warn("[bridge] Ignoring invalid recovery store:", error);
      return emptyStore(networkId);
    }
  } catch (error) {
    console.warn("[bridge] Failed to load recovery store:", error);
    return emptyStore(networkId);
  }
}

export async function listIncompleteSessions(networkId: string): Promise<BridgeSessionEntry[]> {
  const store = await loadSessionStore(networkId);
  return Object.values(store.sessions)
    .filter((entry) => entry.networkId === networkId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActiveSession(networkId: string): Promise<BridgeSessionEntry | null> {
  const store = await loadSessionStore(networkId);
  if (!store.activeL1TxHash) return null;
  return store.sessions[store.activeL1TxHash] ?? null;
}

export async function setActiveSession(
  networkId: string,
  l1TxHash: string | null,
): Promise<BridgeSessionStoreV2> {
  const store = await loadSessionStore(networkId);
  const next = {
    ...store,
    updatedAt: Date.now(),
    activeL1TxHash: l1TxHash ? normalizeL1TxHash(l1TxHash) : null,
  };
  await writeStore(next);
  return next;
}

export async function upsertSession(
  networkId: string,
  patch: {
    l1TxHash: string;
    phase: ClaimPhase;
    recipient: string;
    claimAmount: string;
    pending?: PendingBridge;
    credentials?: ClaimCredentials;
    claimJobId?: string;
    claimChannel?: ClaimChannel;
    l2TxHash?: string;
    lastError?: string;
    makeActive?: boolean;
  },
): Promise<BridgeSessionEntry> {
  await assertBridgeStorageReady();
  const store = await loadSessionStore(networkId);
  const key = normalizeL1TxHash(patch.l1TxHash);
  const existing = store.sessions[key];
  const now = Date.now();
  const nextEntry = validateSessionEntry({
    l1TxHash: normalizeL1TxHash(patch.l1TxHash),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    phase: patch.phase,
    networkId,
    recipient: patch.recipient,
    claimAmount: patch.claimAmount,
    ...(patch.pending ? { pending: patch.pending } : {}),
    ...(patch.credentials ? { credentials: patch.credentials } : {}),
    ...(patch.claimJobId ? { claimJobId: patch.claimJobId } : {}),
    ...(patch.claimChannel ? { claimChannel: patch.claimChannel } : {}),
    ...(patch.l2TxHash ? { l2TxHash: patch.l2TxHash } : {}),
    ...(patch.lastError ? { lastError: patch.lastError } : {}),
  });

  const nextStore: BridgeSessionStoreV2 = {
    ...store,
    updatedAt: now,
    activeL1TxHash:
      patch.makeActive === false
        ? store.activeL1TxHash
        : key,
    sessions: {
      ...store.sessions,
      [key]: nextEntry,
    },
  };
  await writeStore(nextStore);

  const verified = (await loadSessionStore(networkId)).sessions[key];
  if (!verified) {
    throw new BridgeStorageError("Failed to verify recovery session after save.");
  }
  return verified;
}

export async function removeSession(networkId: string, l1TxHash: string): Promise<void> {
  const store = await loadSessionStore(networkId);
  const key = normalizeL1TxHash(l1TxHash);
  if (!store.sessions[key]) return;
  const { [key]: _removed, ...sessions } = store.sessions;
  const next: BridgeSessionStoreV2 = {
    ...store,
    updatedAt: Date.now(),
    activeL1TxHash: store.activeL1TxHash === key ? Object.keys(sessions)[0] ?? null : store.activeL1TxHash,
    sessions,
  };
  await writeStore(next);
}

export async function clearAllSessions(networkId?: string): Promise<void> {
  if (!isVaultUnlocked()) {
    // Still wipe any leftover plaintext LS
    wipeLegacyLocalSessions(networkId);
    return;
  }
  if (!networkId) {
    // Clear known network docs by writing empties is insufficient; list and clear via set empty
    wipeLegacyLocalSessions();
    return;
  }
  await vaultSetJson(vaultDocId(networkId), emptyStore(networkId));
  wipeLegacyLocalSessions(networkId);
}

function wipeLegacyLocalSessions(networkId?: string): void {
  if (typeof localStorage === "undefined") return;
  if (!networkId) {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => !!key);
    for (const key of keys) {
      if (key === V2_STORAGE_KEY || key.startsWith(`${V2_STORAGE_KEY}:`)) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem(V1_STORAGE_KEY);
    return;
  }
  localStorage.removeItem(storageKey(networkId));
  for (const legacyKey of [V2_STORAGE_KEY, V1_STORAGE_KEY]) {
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) continue;
    try {
      const parsed = JSON.parse(legacy) as Record<string, unknown>;
      if (parsed.networkId === networkId) localStorage.removeItem(legacyKey);
    } catch {
      // Leave malformed data for the matching load path to discard.
    }
  }
}

/** Compatibility helpers used by older App.tsx call sites during migration. */
export async function loadBridgeSession(networkId: string): Promise<BridgeSessionEntry | null> {
  return getActiveSession(networkId);
}

export async function saveBridgeSession(session: {
  networkId: string;
  l1TxHash: string;
  claimPhase?: ClaimPhase;
  pending?: PendingBridge;
  credentials?: ClaimCredentials;
  claimJobId?: string;
  claimChannel?: ClaimChannel;
  l2TxHash?: string;
  lastError?: string;
}): Promise<BridgeSessionEntry> {
  const recipient =
    session.credentials?.recipient ??
    session.pending?.recipient;
  const claimAmount =
    session.credentials?.claimAmount ??
    session.pending?.claimAmount;
  if (!recipient || !claimAmount) {
    throw new BridgeStorageError("Cannot save recovery session without recipient/amount.");
  }
  return upsertSession(session.networkId, {
    l1TxHash: session.l1TxHash,
    phase: session.claimPhase ?? (session.credentials ? "ready-to-claim" : "l1-pending"),
    recipient,
    claimAmount,
    pending: session.pending,
    credentials: session.credentials,
    claimJobId: session.claimJobId,
    claimChannel: session.claimChannel,
    l2TxHash: session.l2TxHash,
    lastError: session.lastError,
    makeActive: true,
  });
}

export async function clearBridgeSession(l1TxHash?: string, networkId?: string): Promise<void> {
  if (l1TxHash && networkId) {
    await removeSession(networkId, l1TxHash);
    return;
  }
  await clearAllSessions(networkId);
}
