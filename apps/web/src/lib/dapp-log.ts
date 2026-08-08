/**
 * In-app dapp log bus — tx / info / error / announce toasts.
 * Boot code can push before React mounts; the toaster drains the queue.
 */

import { redactForLog } from "./privacy.ts";

export type DappLogKind = "tx" | "info" | "error" | "announce";

export type DappLogInput = {
  kind: DappLogKind;
  title: string;
  detail?: string;
  /** Auto-dismiss ms; 0 = sticky until dismissed. Defaults by kind. */
  ttlMs?: number;
};

export type DappLogEntry = DappLogInput & {
  id: string;
  at: number;
};

const MAX_PENDING = 24;
const pending: DappLogInput[] = [];
const listeners = new Set<(entry: DappLogInput) => void>();

export function defaultTtlMs(kind: DappLogKind): number {
  switch (kind) {
    case "error":
      return 0;
    case "announce":
      return 20_000;
    case "tx":
      return 14_000;
    default:
      return 10_000;
  }
}

export function pushDappLog(input: DappLogInput): void {
  const entry: DappLogInput = {
    ...input,
    title: redactForLog(input.title),
    detail: input.detail ? redactForLog(input.detail) : undefined,
  };
  if (listeners.size === 0) {
    pending.push(entry);
    while (pending.length > MAX_PENDING) pending.shift();
    return;
  }
  for (const listener of listeners) listener(entry);
}

/** Subscribe; immediately drains any boot-time pending entries. */
export function subscribeDappLog(listener: (entry: DappLogInput) => void): () => void {
  listeners.add(listener);
  const queued = pending.splice(0, pending.length);
  for (const entry of queued) listener(entry);
  return () => {
    listeners.delete(listener);
  };
}

export function formatDappError(error: unknown): { title: string; detail: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = redactForLog(raw);

  if (/Content Security Policy|violates the document'?s Content Security Policy/i.test(raw)) {
    return {
      title: "PXE blocked by Content Security Policy",
      detail:
        "The browser refused a data: circuit / WASM download (connect-src). Reload after updating CSP, then retry Import → PXE.",
    };
  }
  if (/Failed to fetch/i.test(raw)) {
    return {
      title: "PXE / network fetch failed",
      detail:
        "Could not reach the Aztec node or load PXE assets. Check node URL, HTTPS, and that the host is on the CSP connect-src allowlist.",
    };
  }
  if (/User rejected|denied|ACTION_REJECTED/i.test(raw)) {
    return {
      title: "Wallet rejected the request",
      detail,
    };
  }
  return {
    title: "Dapp error",
    detail,
  };
}

export function logDappError(error: unknown, titleOverride?: string): void {
  const formatted = formatDappError(error);
  pushDappLog({
    kind: "error",
    title: titleOverride ?? formatted.title,
    detail: formatted.detail,
  });
}
