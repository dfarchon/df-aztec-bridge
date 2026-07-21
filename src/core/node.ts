import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { defaultFetch } from "@aztec/foundation/json-rpc/client";

export const AZTEC_API_KEY_HEADER = "X-Aztec-API-Key";

let cached: { url: string; apiKey?: string; client: AztecNode } | null = null;

/** Create (or reuse) an Aztec node JSON-RPC client, optionally with gateway API key. */
export function createNode(url: string, apiKey?: string): AztecNode {
  if (cached && cached.url === url && cached.apiKey === apiKey) return cached.client;

  const fetchFn: typeof defaultFetch | undefined = apiKey
    ? (host, body, extraHeaders = {}, noRetry = false) =>
        defaultFetch(host, body, { ...extraHeaders, [AZTEC_API_KEY_HEADER]: apiKey }, noRetry)
    : undefined;

  const client = createAztecNodeClient(url, undefined, fetchFn);
  cached = { url, apiKey, client };
  return client;
}
