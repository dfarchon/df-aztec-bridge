import type { ClaimCredentials, PendingBridge } from "@df-bridge/browser-sdk";

const V1_STORAGE_KEY = "df_aztec_bridge_session";
const V2_STORAGE_KEY = "df_aztec_bridge_sessions";
const PROBE_KEY = "df_aztec_bridge_storage_probe";

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

function readRawStore(): unknown | null {
  const v2 = localStorage.getItem(V2_STORAGE_KEY);
  if (v2) return JSON.parse(v2) as unknown;
  const v1 = localStorage.getItem(V1_STORAGE_KEY);
  if (v1) return JSON.parse(v1) as unknown;
  return null;
}

function writeStore(store: BridgeSessionStoreV2) {
  localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(store));
  localStorage.removeItem(V1_STORAGE_KEY);
}

export function assertBridgeStorageReady(): void {
  try {
    localStorage.setItem(PROBE_KEY, "1");
    if (localStorage.getItem(PROBE_KEY) !== "1") {
      throw new BridgeStorageError("Browser storage write verification failed.");
    }
    localStorage.removeItem(PROBE_KEY);

    const probeStore: BridgeSessionStoreV2 = {
      version: 2,
      networkId: "__probe__",
      updatedAt: Date.now(),
      activeL1TxHash: null,
      sessions: {},
    };
    const probeKey = `${V2_STORAGE_KEY}__probe`;
    localStorage.setItem(probeKey, JSON.stringify(probeStore));
    const roundTrip = JSON.parse(localStorage.getItem(probeKey) ?? "null") as unknown;
    localStorage.removeItem(probeKey);
    if (!roundTrip || typeof roundTrip !== "object") {
      throw new BridgeStorageError("Browser storage round-trip verification failed.");
    }
  } catch (error) {
    if (error instanceof BridgeStorageError) throw error;
    throw new BridgeStorageError(
      "Browser storage is blocked or full — claim recovery will not work. Fix storage and try again.",
    );
  }
}

export function loadSessionStore(networkId: string): BridgeSessionStoreV2 {
  try {
    const raw = readRawStore();
    if (!raw) return emptyStore(networkId);

    if (isBridgeSessionV1(raw)) {
      if (raw.networkId !== networkId) return emptyStore(networkId);
      const migrated = migrateV1(raw);
      writeStore(migrated);
      return migrated;
    }

    try {
      return validateStore(raw, networkId);
    } catch (error) {
      console.warn("[bridge] Clearing invalid recovery store:", error);
      localStorage.removeItem(V2_STORAGE_KEY);
      localStorage.removeItem(V1_STORAGE_KEY);
      return emptyStore(networkId);
    }
  } catch (error) {
    console.warn("[bridge] Failed to load recovery store:", error);
    return emptyStore(networkId);
  }
}

export function listIncompleteSessions(networkId: string): BridgeSessionEntry[] {
  const store = loadSessionStore(networkId);
  return Object.values(store.sessions)
    .filter((entry) => entry.networkId === networkId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveSession(networkId: string): BridgeSessionEntry | null {
  const store = loadSessionStore(networkId);
  if (!store.activeL1TxHash) return null;
  return store.sessions[store.activeL1TxHash] ?? null;
}

export function setActiveSession(networkId: string, l1TxHash: string | null): BridgeSessionStoreV2 {
  const store = loadSessionStore(networkId);
  const next = {
    ...store,
    updatedAt: Date.now(),
    activeL1TxHash: l1TxHash ? normalizeL1TxHash(l1TxHash) : null,
  };
  writeStore(next);
  return next;
}

export function upsertSession(
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
): BridgeSessionEntry {
  assertBridgeStorageReady();
  const store = loadSessionStore(networkId);
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
  writeStore(nextStore);

  const verified = loadSessionStore(networkId).sessions[key];
  if (!verified) {
    throw new BridgeStorageError("Failed to verify recovery session after save.");
  }
  return verified;
}

export function removeSession(networkId: string, l1TxHash: string): void {
  const store = loadSessionStore(networkId);
  const key = normalizeL1TxHash(l1TxHash);
  if (!store.sessions[key]) return;
  const { [key]: _removed, ...sessions } = store.sessions;
  const next: BridgeSessionStoreV2 = {
    ...store,
    updatedAt: Date.now(),
    activeL1TxHash: store.activeL1TxHash === key ? Object.keys(sessions)[0] ?? null : store.activeL1TxHash,
    sessions,
  };
  writeStore(next);
}

export function clearAllSessions(networkId?: string): void {
  if (!networkId) {
    localStorage.removeItem(V2_STORAGE_KEY);
    localStorage.removeItem(V1_STORAGE_KEY);
    return;
  }
  writeStore(emptyStore(networkId));
}

/** Compatibility helpers used by older App.tsx call sites during migration. */
export function loadBridgeSession(networkId: string): BridgeSessionEntry | null {
  return getActiveSession(networkId);
}

export function saveBridgeSession(session: {
  networkId: string;
  l1TxHash: string;
  claimPhase?: ClaimPhase;
  pending?: PendingBridge;
  credentials?: ClaimCredentials;
  claimJobId?: string;
  claimChannel?: ClaimChannel;
  l2TxHash?: string;
  lastError?: string;
}): BridgeSessionEntry {
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

export function clearBridgeSession(l1TxHash?: string, networkId?: string): void {
  if (l1TxHash && networkId) {
    removeSession(networkId, l1TxHash);
    return;
  }
  clearAllSessions(networkId);
}
