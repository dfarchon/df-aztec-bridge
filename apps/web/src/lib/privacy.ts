/**
 * Client privacy / anti-telemetry helpers.
 * - No third-party analytics
 * - Do not read geolocation / locale for fingerprinting
 * - Redact IP-like and secret material from logs
 */

const HEX_64 = /0x[a-fA-F0-9]{64}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi;

export function redactForLog(input: string): string {
  return input
    .replace(HEX_64, "0x[REDACTED]")
    .replace(IPV4, "[IP_REDACTED]")
    .replace(IPV6, "[IP_REDACTED]");
}

/** Safe console wrapper — never emit raw secrets / IPs from app code. */
export function privacyWarn(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[${scope}]`, redactForLog(message));
}

/**
 * Headers we intentionally omit from outbound app fetches to reduce
 * localization / correlation signals beyond what the browser already sends.
 */
export const PRIVACY_FETCH_HEADERS: HeadersInit = {
  "Accept-Language": "en",
  // DNT is advisory; still set for operators that honor it.
  DNT: "1",
};

export async function privacyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(PRIVACY_FETCH_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  // Never attach custom client IP / geo headers.
  headers.delete("X-Forwarded-For");
  headers.delete("X-Real-IP");
  headers.delete("CF-Connecting-IP");
  headers.delete("True-Client-IP");
  return fetch(input, { ...init, headers, credentials: "omit", referrerPolicy: "no-referrer" });
}

/** Do not use navigator.language / geolocation for product logic. */
export function assertNoLocalizationSideChannels(): void {
  // Intentional no-op guard used at boot to document policy.
  if (typeof navigator !== "undefined" && "geolocation" in navigator) {
    // Never call navigator.geolocation.*
  }
}
