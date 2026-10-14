/**
 * Encrypted operation history in the password vault.
 * Stores public outcomes only — never claim secrets, account keys, or passwords.
 */

import { formatFjAmount } from "./bridge-amount.ts";
import { isVaultUnlocked, vaultGetJson, vaultSetJson } from "./vault.ts";

export const HISTORY_DOC_ID = "history";
export const HISTORY_MAX_ENTRIES = 200;

export type HistoryKind =
  | "l1-submitted"
  | "l1-confirmed"
  | "claim-imported"
  | "claim-submitted"
  | "claim-confirmed"
  | "claim-failed"
  | "claim-removed"
  | "account-imported"
  | "account-replaced"
  | "account-removed";

export type HistoryEntry = {
  id: string;
  at: number;
  networkId: string;
  kind: HistoryKind;
  title: string;
  detail?: string;
  amount?: string;
  recipient?: string;
  l1TxHash?: string;
  l2TxHash?: string;
};

export type HistoryDraft = Omit<HistoryEntry, "id" | "at" | "title"> & {
  title?: string;
  at?: number;
};

type HistoryDoc = {
  version: 1;
  entries: HistoryEntry[];
};

const KINDS = new Set<HistoryKind>([
  "l1-submitted",
  "l1-confirmed",
  "claim-imported",
  "claim-submitted",
  "claim-confirmed",
  "claim-failed",
  "claim-removed",
  "account-imported",
  "account-replaced",
  "account-removed",
]);

export function formatHistoryAmount(amount?: string): string | undefined {
  if (!amount?.trim()) return undefined;
  try {
    return formatFjAmount(BigInt(amount), 5);
  } catch {
    return amount;
  }
}

export function historyTitle(kind: HistoryKind, amount?: string): string {
  const fj = formatHistoryAmount(amount);
  switch (kind) {
    case "l1-submitted":
      return fj ? `${fj} FJ deposited on Ethereum` : "Deposited on Ethereum";
    case "l1-confirmed":
      return fj ? `${fj} FJ ready to claim` : "Deposit confirmed";
    case "claim-imported":
      return fj ? `${fj} FJ claim imported` : "Claim imported";
    case "claim-submitted":
      return fj ? `${fj} FJ claim submitted` : "Claim submitted";
    case "claim-confirmed":
      return fj ? `${fj} FJ claimed` : "Claimed";
    case "claim-failed":
      return fj ? `${fj} FJ claim failed` : "Claim failed";
    case "claim-removed":
      return fj ? `${fj} FJ claim removed` : "Claim removed";
    case "account-imported":
      return "Account imported";
    case "account-replaced":
      return "Account replaced";
    case "account-removed":
      return "Account removed";
  }
}

export function groupHistoryByDay(
  entries: HistoryEntry[],
): { day: string; items: HistoryEntry[] }[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.at).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const list = groups.get(day) ?? [];
    list.push(entry);
    groups.set(day, list);
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }));
}

function emptyDoc(): HistoryDoc {
  return { version: 1, entries: [] };
}

function asEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.at !== "number" || !Number.isFinite(row.at)) return null;
  if (typeof row.networkId !== "string" || !row.networkId) return null;
  if (typeof row.kind !== "string" || !KINDS.has(row.kind as HistoryKind)) return null;
  if (typeof row.title !== "string" || !row.title) return null;
  return {
    id: row.id,
    at: row.at,
    networkId: row.networkId,
    kind: row.kind as HistoryKind,
    title: row.title,
    ...(typeof row.detail === "string" && row.detail ? { detail: row.detail } : {}),
    ...(typeof row.amount === "string" && row.amount ? { amount: row.amount } : {}),
    ...(typeof row.recipient === "string" && row.recipient ? { recipient: row.recipient } : {}),
    ...(typeof row.l1TxHash === "string" && row.l1TxHash ? { l1TxHash: row.l1TxHash } : {}),
    ...(typeof row.l2TxHash === "string" && row.l2TxHash ? { l2TxHash: row.l2TxHash } : {}),
  };
}

async function readDoc(): Promise<HistoryDoc> {
  if (!isVaultUnlocked()) return emptyDoc();
  const raw = await vaultGetJson<unknown>(HISTORY_DOC_ID);
  if (!raw || typeof raw !== "object") return emptyDoc();
  const entries = Array.isArray((raw as HistoryDoc).entries)
    ? (raw as HistoryDoc).entries.map(asEntry).filter((row): row is HistoryEntry => !!row)
    : [];
  return { version: 1, entries };
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const doc = await readDoc();
  return [...doc.entries].sort((a, b) => b.at - a.at);
}

export async function appendHistory(draft: HistoryDraft): Promise<HistoryEntry | null> {
  if (!isVaultUnlocked()) return null;
  const entry: HistoryEntry = {
    id: `${draft.at ?? Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: draft.at ?? Date.now(),
    networkId: draft.networkId,
    kind: draft.kind,
    title: draft.title ?? historyTitle(draft.kind, draft.amount),
    ...(draft.detail ? { detail: draft.detail } : {}),
    ...(draft.amount ? { amount: draft.amount } : {}),
    ...(draft.recipient ? { recipient: draft.recipient } : {}),
    ...(draft.l1TxHash ? { l1TxHash: draft.l1TxHash } : {}),
    ...(draft.l2TxHash ? { l2TxHash: draft.l2TxHash } : {}),
  };
  const doc = await readDoc();
  const entries = [entry, ...doc.entries].slice(0, HISTORY_MAX_ENTRIES);
  await vaultSetJson(HISTORY_DOC_ID, { version: 1, entries });
  return entry;
}

/** Best-effort write. A locked vault or storage error must not block the flow. */
export async function recordHistory(draft: HistoryDraft): Promise<void> {
  try {
    await appendHistory(draft);
  } catch {
    /* history is optional */
  }
}
