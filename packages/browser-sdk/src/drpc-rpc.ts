/**
 * dRPC public gateways whitelist the legacy `node_*` JSON-RPC names.
 * aztec.js 5.1 emits `aztec_*`; rewrite only for dRPC hosts.
 */

function hostnameOf(host: string): string | null {
  const trimmed = host.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDrpcRpcHost(host: string): boolean {
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  return (
    hostname === "drpc.org" ||
    hostname.endsWith(".drpc.org") ||
    hostname === "drpc.live" ||
    hostname.endsWith(".drpc.live")
  );
}

function rewriteMethodName(method: unknown): unknown {
  if (typeof method !== "string" || !method.startsWith("aztec_")) return method;
  return `node_${method.slice("aztec_".length)}`;
}

function rewriteRpcRequest(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const rec = item as Record<string, unknown>;
  const nextMethod = rewriteMethodName(rec.method);
  if (nextMethod === rec.method) return item;
  return { ...rec, method: nextMethod };
}

/** Rewrite a single JSON-RPC object or a batch array. */
export function rewriteAztecRpcMethodsForDrpc(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(rewriteRpcRequest);
  return rewriteRpcRequest(body);
}

export function maybeRewriteAztecRpcForHost(host: string, body: unknown): unknown {
  return isDrpcRpcHost(host) ? rewriteAztecRpcMethodsForDrpc(body) : body;
}
