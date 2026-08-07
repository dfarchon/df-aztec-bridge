/**
 * Fetch Aztec HTTPS node RPCs from the public Chainlist registry
 * (https://chainlist.org — community EVM/RPC directory; Aztec Mainnet chainId 677868).
 * No new npm packages — native fetch + JSON parse.
 */

export const CHAINLIST_RPCS_JSON = "https://chainlist.org/rpcs.json";
/** Official Chainlist page for Aztec Mainnet RPC search / listing. */
export const CHAINLIST_AZTEC_PAGE = "https://chainlist.org/chain/677868";
export const AZTEC_CHAINLIST_CHAIN_ID = 677868;

export type ChainlistRpcOption = {
  url: string;
  source: "current" | "chainlist" | "network-default" | "fallback";
  label: string;
};

type ChainlistRpcEntry = string | { url?: string };

type ChainlistChain = {
  name?: string;
  chain?: string;
  chainId?: number;
  isTestnet?: boolean;
  rpc?: ChainlistRpcEntry[];
};

let cache: { at: number; httpsUrls: string[] } | null = null;
const CACHE_MS = 15 * 60 * 1000;

function rpcUrlOf(entry: ChainlistRpcEntry): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry.url === "string") return entry.url.trim() || null;
  return null;
}

/** Keep browser Aztec node HTTP(S) endpoints only (drop wss / tracking junk). */
export function isSelectableAztecNodeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.protocol === "http:") {
      const host = u.hostname.toLowerCase();
      if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
    }
    // Drop obvious API-key / tracking query forms from public lists when empty path providers.
    if (/\$\{|API_KEY|apiKey/i.test(url)) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractAztecHttpsRpcs(chains: unknown): string[] {
  if (!Array.isArray(chains)) return [];
  const urls = new Set<string>();
  for (const raw of chains as ChainlistChain[]) {
    if (!raw || typeof raw !== "object") continue;
    const matchId = raw.chainId === AZTEC_CHAINLIST_CHAIN_ID;
    const matchName =
      /aztec/i.test(raw.name ?? "") || /aztec/i.test(raw.chain ?? "");
    if (!matchId && !matchName) continue;
    for (const entry of raw.rpc ?? []) {
      const url = rpcUrlOf(entry);
      if (!url || !isSelectableAztecNodeUrl(url)) continue;
      if (url.startsWith("wss:")) continue;
      urls.add(url.replace(/\/$/, ""));
    }
  }
  return [...urls].sort();
}

export async function fetchChainlistAztecRpcs(opts?: {
  signal?: AbortSignal;
  force?: boolean;
}): Promise<string[]> {
  if (!opts?.force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.httpsUrls;
  }
  const res = await fetch(CHAINLIST_RPCS_JSON, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    signal: opts?.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Chainlist HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  const httpsUrls = extractAztecHttpsRpcs(json);
  cache = { at: Date.now(), httpsUrls };
  return httpsUrls;
}

/** Build select options: current → network default → preferred fallbacks → Chainlist. */
export function buildAztecRpcOptions(opts: {
  currentUrl: string;
  networkDefaultUrl: string;
  /** Extra preferred endpoints after the network default (e.g. public dRPC). */
  preferredUrls?: string[];
  chainlistUrls: string[];
}): ChainlistRpcOption[] {
  const out: ChainlistRpcOption[] = [];
  const seen = new Set<string>();
  const add = (url: string, source: ChainlistRpcOption["source"], label: string) => {
    const cleaned = url.trim().replace(/\/$/, "");
    if (!cleaned || seen.has(cleaned.toLowerCase())) return;
    if (!isSelectableAztecNodeUrl(cleaned) && source === "current") {
      // Still allow showing the current value even if exotic (user may fix).
    } else if (!isSelectableAztecNodeUrl(cleaned)) {
      return;
    }
    seen.add(cleaned.toLowerCase());
    out.push({ url: cleaned, source, label });
  };

  if (opts.currentUrl.trim()) {
    add(opts.currentUrl, "current", "Current");
  }
  if (opts.networkDefaultUrl.trim()) {
    add(opts.networkDefaultUrl, "network-default", "Network default");
  }
  for (const url of opts.preferredUrls ?? []) {
    add(url, "fallback", "Public fallback");
  }
  for (const url of opts.chainlistUrls) {
    add(url, "chainlist", "Chainlist");
  }
  return out;
}
