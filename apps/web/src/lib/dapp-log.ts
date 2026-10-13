/**
 * In-app dapp log bus — tx / info / error / announce toasts.
 * Boot code can push before React mounts; the toaster drains the queue.
 */

import {
  aztecExplorerLinkLabel,
  aztecScanTxEffectUrl,
  l1ExplorerLinkLabel,
  l1TxUrl,
} from "./official-links.ts";
import { formatForDappToast, redactForLog } from "./privacy.ts";

/**
 * Activity toasts. Hidden unless `VITE_ENABLE_DAPP_LOG=true` (build-time).
 * Unset or any other value keeps the panel off.
 */
export const DAPP_LOG_ENABLED = import.meta.env.VITE_ENABLE_DAPP_LOG === "true";

export type DappLogKind = "tx" | "info" | "error" | "announce";

/** Explorer deep-link for a toast (hash kept raw; title/detail still toast-formatted). */
export type DappLogTxLink = {
  layer: "l1" | "l2";
  hash: string;
  href: string | null;
  explorerLabel: string;
};

export type DappLogInput = {
  kind: DappLogKind;
  title: string;
  detail?: string;
  /** Auto-dismiss ms; 0 = sticky until dismissed. Defaults by kind. */
  ttlMs?: number;
  /** Optional explorer link for L1 / L2 transaction toasts. */
  txLink?: DappLogTxLink;
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
    title: formatForDappToast(input.title),
    detail: input.detail ? formatForDappToast(input.detail) : undefined,
    // Keep raw hash / href for the link row (do not toast-format href).
    txLink: input.txLink
      ? {
          ...input.txLink,
          hash: input.txLink.hash.trim(),
        }
      : undefined,
  };
  if (listeners.size === 0) {
    pending.push(entry);
    while (pending.length > MAX_PENDING) pending.shift();
    return;
  }
  for (const listener of listeners) listener(entry);
}

export function pushL1TxDappLog(opts: {
  title: string;
  txHash: string;
  l1ExplorerUrl?: string;
  ttlMs?: number;
}): void {
  const hash = opts.txHash.trim();
  const href = l1TxUrl(opts.l1ExplorerUrl, hash);
  pushDappLog({
    kind: "tx",
    title: opts.title,
    detail: hash,
    ttlMs: opts.ttlMs,
    txLink: {
      layer: "l1",
      hash,
      href,
      explorerLabel: l1ExplorerLinkLabel(opts.l1ExplorerUrl),
    },
  });
}

export function pushL2TxDappLog(opts: {
  title: string;
  txHash: string;
  networkId: string;
  aztecExplorerUrl?: string;
  ttlMs?: number;
}): void {
  const hash = opts.txHash.trim();
  const href = aztecScanTxEffectUrl(opts.networkId, hash, opts.aztecExplorerUrl);
  pushDappLog({
    kind: "tx",
    title: opts.title,
    detail: hash,
    ttlMs: opts.ttlMs,
    txLink: {
      layer: "l2",
      hash,
      href,
      explorerLabel: aztecExplorerLinkLabel(opts.aztecExplorerUrl),
    },
  });
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
