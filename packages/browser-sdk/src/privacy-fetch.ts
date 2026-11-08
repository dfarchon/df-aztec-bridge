/**
 * Outbound fetch hygiene for SDK RPC calls (omit credentials, harden referrer).
 * Mirrors apps/web privacyFetch without pulling the web package into the SDK.
 */

export const PRIVACY_FETCH_HEADERS: HeadersInit = {
  "Accept-Language": "en",
  DNT: "1",
};

export async function privacyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(PRIVACY_FETCH_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  headers.delete("X-Forwarded-For");
  headers.delete("X-Real-IP");
  headers.delete("CF-Connecting-IP");
  headers.delete("True-Client-IP");
  return fetch(input, { ...init, headers, credentials: "omit", referrerPolicy: "no-referrer" });
}
