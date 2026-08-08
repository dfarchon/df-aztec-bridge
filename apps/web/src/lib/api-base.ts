/**
 * Claim/job API must stay same-origin (/api Vite proxy) or loopback.
 * Remote VITE_API_BASE would force baking API_AUTH_TOKEN into the client bundle.
 */

export function isLoopbackApiBase(base: string): boolean {
  const trimmed = base.trim();
  if (!trimmed) return false;
  if (trimmed === "/api" || trimmed.startsWith("/api/")) return true;
  try {
    const u = new URL(trimmed, "http://127.0.0.1");
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function assertSafeClaimApiBase(base: string): void {
  if (!isLoopbackApiBase(base)) {
    throw new Error(
      "Claim API base must be /api (Vite proxy) or http(s)://127.0.0.1|localhost. " +
        "Remote API claim is disabled — use VITE_ENABLE_BROWSER_CLAIM=true.",
    );
  }
}
