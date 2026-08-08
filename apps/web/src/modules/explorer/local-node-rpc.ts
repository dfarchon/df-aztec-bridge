import { privacyFetch } from "../../lib/privacy.ts";

export async function nodeJsonRpc<T>(
  url: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await privacyFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status} for ${method}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) {
    throw new Error(body.error.message ?? `RPC error for ${method}`);
  }
  return body.result as T;
}

export type LocalNodeInfo = {
  nodeVersion?: string;
  l1ChainId?: number;
  rollupVersion?: number | string;
  enr?: string;
};

export async function fetchNodeInfo(url: string): Promise<LocalNodeInfo> {
  const raw = await nodeJsonRpc<Record<string, unknown>>(url, "node_getNodeInfo");
  return {
    nodeVersion:
      typeof raw.nodeVersion === "string"
        ? raw.nodeVersion
        : typeof raw.version === "string"
          ? raw.version
          : undefined,
    l1ChainId: typeof raw.l1ChainId === "number" ? raw.l1ChainId : undefined,
    rollupVersion:
      typeof raw.rollupVersion === "number" || typeof raw.rollupVersion === "string"
        ? raw.rollupVersion
        : undefined,
  };
}

export async function fetchBlockNumber(url: string): Promise<number> {
  return Number(await nodeJsonRpc<number | string>(url, "node_getBlockNumber"));
}

/** Best-effort block fetch — Aztec node shapes vary slightly by version. */
export async function fetchBlock(url: string, blockNumber: number): Promise<unknown> {
  try {
    return await nodeJsonRpc(url, "node_getBlock", [blockNumber]);
  } catch {
    return await nodeJsonRpc(url, "node_getBlock", [String(blockNumber)]);
  }
}

export async function fetchTxEffect(url: string, txHash: string): Promise<unknown> {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return nodeJsonRpc(url, "node_getTxEffect", [hash]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Pull tx hashes / effect refs from a block payload when present. */
export function extractTxHashesFromBlock(block: unknown): string[] {
  const root = asRecord(block);
  if (!root) return [];
  const candidates: unknown[] = [
    root.txHashes,
    root.txEffects,
    asRecord(root.body)?.txEffects,
    asRecord(root.body)?.txHashes,
    asRecord(root.header)?.txHashes,
  ];
  const out: string[] = [];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    for (const item of c) {
      if (typeof item === "string") {
        out.push(item.startsWith("0x") ? item : `0x${item}`);
        continue;
      }
      const rec = asRecord(item);
      if (!rec) continue;
      const h = rec.txHash ?? rec.hash ?? rec.txEffectHash;
      if (typeof h === "string") out.push(h.startsWith("0x") ? h : `0x${h}`);
    }
  }
  return [...new Set(out)];
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
