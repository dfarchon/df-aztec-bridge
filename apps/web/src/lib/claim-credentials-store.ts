import type { ClaimCredentials } from "@df-bridge/browser-sdk";

export type StoredClaimSession = {
  version: 1;
  networkId: string;
  l1TxHash: string;
  recipient: string;
  credentials: ClaimCredentials;
  savedAt: string;
};

const STORAGE_KEY = "df-bridge:claim-credentials";

function isClaimCredentials(value: unknown): value is ClaimCredentials {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.claimSecret === "string" &&
    typeof c.claimSecretHash === "string" &&
    typeof c.messageHash === "string" &&
    typeof c.messageLeafIndex === "string" &&
    typeof c.claimAmount === "string" &&
    typeof c.recipient === "string"
  );
}

function parseSession(raw: unknown): StoredClaimSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.networkId !== "string") return null;
  if (typeof o.l1TxHash !== "string") return null;
  if (typeof o.recipient !== "string") return null;
  if (!isClaimCredentials(o.credentials)) return null;
  return {
    version: 1,
    networkId: o.networkId,
    l1TxHash: o.l1TxHash,
    recipient: o.recipient,
    credentials: o.credentials,
    savedAt: typeof o.savedAt === "string" ? o.savedAt : new Date().toISOString(),
  };
}

export function saveClaimSession(
  session: Omit<StoredClaimSession, "version" | "savedAt">,
): StoredClaimSession {
  const stored: StoredClaimSession = {
    version: 1,
    ...session,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export function loadClaimSession(networkId?: string): StoredClaimSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = parseSession(JSON.parse(raw));
    if (!session) return null;
    if (networkId && session.networkId !== networkId) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearClaimSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** JSON shape accepted by df-bridge CLI `claim -c`. */
export function claimCredentialsDownloadPayload(
  recipient: string,
  credentials: ClaimCredentials,
  extras?: { l1TxHash?: string; networkId?: string },
) {
  return {
    recipient,
    credentials,
    ...(extras?.l1TxHash ? { l1TxHash: extras.l1TxHash } : {}),
    ...(extras?.networkId ? { networkId: extras.networkId } : {}),
  };
}

export function claimCredentialsFilename(recipient: string, l1TxHash?: string): string {
  const shortRecipient = recipient.replace(/^0x/i, "").slice(0, 10);
  if (l1TxHash) {
    const shortTx = l1TxHash.replace(/^0x/i, "").slice(0, 10);
    return `claim-${shortRecipient}-${shortTx}.json`;
  }
  return `claim-${shortRecipient}.json`;
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadClaimCredentials(
  recipient: string,
  credentials: ClaimCredentials,
  opts?: { l1TxHash?: string; networkId?: string },
): void {
  downloadJson(
    claimCredentialsFilename(recipient, opts?.l1TxHash),
    claimCredentialsDownloadPayload(recipient, credentials, opts),
  );
}

/** Persist to localStorage and optionally trigger a credentials JSON download. */
export function persistClaimCredentials(params: {
  networkId: string;
  l1TxHash: string;
  recipient: string;
  credentials: ClaimCredentials;
  autoDownload?: boolean;
}): StoredClaimSession {
  const session = saveClaimSession({
    networkId: params.networkId,
    l1TxHash: params.l1TxHash,
    recipient: params.recipient,
    credentials: params.credentials,
  });
  if (params.autoDownload !== false) {
    downloadClaimCredentials(params.recipient, params.credentials, {
      l1TxHash: params.l1TxHash,
      networkId: params.networkId,
    });
  }
  return session;
}
