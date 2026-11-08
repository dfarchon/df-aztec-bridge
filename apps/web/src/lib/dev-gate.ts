/**
 * Host classification for Netlify previews.
 * The password check itself is the edge function in netlify/edge-functions.
 * Do not put the preview password or its hash in a VITE_ variable.
 */

export const DEV_GATE_SESSION_KEY = "df-bridge:dev-gate:ok";

/** Production site. Branch deploys and deploy previews use a different host. */
export const PRODUCTION_KIT_HOST = "aztec-dfarchon-kit-v6.netlify.app";

/** Canonical Netlify branch-deploy host for branch `dev`. */
export const DEV_BRANCH_HOST = "dev--aztec-dfarchon-kit-v6.netlify.app";

/** Optional prettier alias if configured in Netlify Domain management. */
export const DEV_ALIAS_HOST = "dev.aztec-dfarchon-kit-v6.netlify.app";

export function isDevGateHost(hostname: string = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h || h === PRODUCTION_KIT_HOST || h === "localhost" || h === "127.0.0.1") return false;
  if (h === DEV_BRANCH_HOST || h === DEV_ALIAS_HOST) return true;
  // deploy-preview-N--site and <branch>--site
  if (h.endsWith(`--${PRODUCTION_KIT_HOST}`)) return true;
  // dev.aztec-dfarchon-kit-v6.netlify.app and other site subdomains
  if (h.endsWith(`.${PRODUCTION_KIT_HOST}`)) return true;
  return false;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
