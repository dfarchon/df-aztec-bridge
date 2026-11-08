import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import {
  BridgeStorageError,
  getActiveSession,
  listIncompleteSessions,
  type BridgeSessionEntry,
} from "../../lib/bridge-session.ts";
import { VaultLockedError } from "../../lib/vault.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Narrow claim-API job create response (loopback / Vite proxy only). */
export type ClaimApiCreateBody = {
  jobId?: string;
  error?: string;
};

/** Narrow claim-API job status poll response. */
export type ClaimApiJobBody = {
  status: string;
  error?: string;
  result?: { l2TxHash?: string };
};

function parseClaimApiCreateBody(value: unknown, label: string): ClaimApiCreateBody {
  if (!isPlainObject(value)) {
    throw new Error(`${label} returned an unexpected JSON shape.`);
  }
  const out: ClaimApiCreateBody = {};
  if (value.jobId !== undefined) {
    if (typeof value.jobId !== "string") {
      throw new Error(`${label} jobId must be a string when present.`);
    }
    out.jobId = value.jobId;
  }
  if (value.error !== undefined) {
    if (typeof value.error !== "string") {
      throw new Error(`${label} error must be a string when present.`);
    }
    out.error = value.error;
  }
  return out;
}

function parseClaimApiJobBody(value: unknown, label: string): ClaimApiJobBody {
  if (!isPlainObject(value)) {
    throw new Error(`${label} returned an unexpected JSON shape.`);
  }
  if (typeof value.status !== "string" || !value.status.trim()) {
    throw new Error(`${label} status must be a non-empty string.`);
  }
  const out: ClaimApiJobBody = { status: value.status };
  if (value.error !== undefined) {
    if (typeof value.error !== "string") {
      throw new Error(`${label} error must be a string when present.`);
    }
    out.error = value.error;
  }
  if (value.result !== undefined) {
    if (!isPlainObject(value.result)) {
      throw new Error(`${label} result must be an object when present.`);
    }
    const l2TxHash = value.result.l2TxHash;
    if (l2TxHash !== undefined && typeof l2TxHash !== "string") {
      throw new Error(`${label} result.l2TxHash must be a string when present.`);
    }
    out.result = l2TxHash !== undefined ? { l2TxHash } : {};
  }
  return out;
}

export async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response (HTTP ${response.status}).`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON (HTTP ${response.status}).`);
  }
}

export async function readClaimApiCreateResponse(
  response: Response,
  label: string,
): Promise<ClaimApiCreateBody> {
  return parseClaimApiCreateBody(await readJsonResponse(response, label), label);
}

export async function readClaimApiJobResponse(
  response: Response,
  label: string,
): Promise<ClaimApiJobBody> {
  return parseClaimApiJobBody(await readJsonResponse(response, label), label);
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
