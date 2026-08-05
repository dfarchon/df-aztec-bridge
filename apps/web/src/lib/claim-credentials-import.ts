import type { ClaimCredentials } from "@df-bridge/browser-sdk";
import { normalizeL1TxHash, validateClaimCredentials } from "./bridge-session.js";

const HEX64 = /^0x[0-9a-fA-F]{64}$/;

export class ClaimCredentialsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimCredentialsImportError";
  }
}

export interface ImportedClaimCredentials {
  l1TxHash: string;
  recipient: string;
  credentials: ClaimCredentials;
  /** Present when the file recorded which network it came from. */
  networkId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Accepts the shapes this project writes out: the web app's credentials
 * download, the CLI `run` / `l1-bridge` output, and a bare ClaimCredentials
 * object. An L1 tx hash is required because it keys the recovery store.
 */
export function parseClaimCredentialsFile(raw: unknown): ImportedClaimCredentials {
  const root = asRecord(raw);
  if (!root) {
    throw new ClaimCredentialsImportError("This file does not contain a JSON object.");
  }

  const nested =
    asRecord(root.credentials) ?? asRecord(root.claimCredentials) ?? null;
  const source = nested ?? root;

  let credentials: ClaimCredentials;
  try {
    credentials = validateClaimCredentials(source);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ClaimCredentialsImportError(
      `This does not look like a claim credentials file — ${detail}`,
    );
  }

  const l1TxHash =
    pickString(root, "l1TxHash") ?? (nested ? pickString(nested, "l1TxHash") : undefined);
  if (!l1TxHash) {
    throw new ClaimCredentialsImportError(
      "The file has no l1TxHash, so it cannot be matched to a bridge. Use the credentials JSON downloaded by this app or the CLI.",
    );
  }
  if (!HEX64.test(l1TxHash)) {
    throw new ClaimCredentialsImportError("The l1TxHash in this file is not a 32-byte hex hash.");
  }

  const recipient =
    pickString(root, "recipient") ??
    pickString(root, "aztecAddress") ??
    credentials.recipient;

  return {
    l1TxHash: normalizeL1TxHash(l1TxHash),
    recipient,
    credentials,
    ...(pickString(root, "networkId") ? { networkId: pickString(root, "networkId") } : {}),
  };
}
