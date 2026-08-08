/**
 * Closed-beta gate for the `dev` Netlify deploy (dev.aztec-dfarchon-kit / branch subdomain).
 *
 * Password is never stored in plaintext — compare SHA-256(password) to
 * VITE_DEV_GATE_PASSWORD_HASH. Client gate alone is not access control — Netlify
 * visitor password (host lock) is required for real preview protection.
 */

export const DEV_GATE_SESSION_KEY = "df-bridge:dev-gate:ok";

/** SHA-256("df-dev-gate") — published in docs/tests; never accept on gated hosts. */
export const DEV_GATE_PUBLISHED_EXAMPLE_HASH =
  "9d4c29eb3daafcb8c52fe441ff6872f54997e934c4958e08663adf3d98e408f9";

const ATTEMPT_WINDOW_MS = 60_000;
const ATTEMPT_MAX = 5;
let attemptTimestamps: number[] = [];

/** Canonical Netlify branch-deploy host for branch `dev`. */
export const DEV_BRANCH_HOST = "dev--aztec-dfarchon-kit.netlify.app";

/** Optional prettier alias if configured in Netlify Domain management. */
export const DEV_ALIAS_HOST = "dev.aztec-dfarchon-kit.netlify.app";

export function isDevGateHost(hostname: string = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (h === DEV_BRANCH_HOST || h === DEV_ALIAS_HOST) return true;
  if (!h.includes("aztec-dfarchon-kit")) return false;
  // Canonical `dev--…` / `dev.…`
  if (h.startsWith("dev--") || h.startsWith("dev.")) return true;
  // Netlify rewrites `9stx6/dev` → `9stx6-dev--…`
  if (h.includes("-dev--") || h.includes("--dev--")) return true;
  return false;
}

/** Gate is on when build flag is set, or when served from a recognized dev host. */
export function isDevGateRequired(): boolean {
  if (import.meta.env.VITE_DEV_GATE === "true") return true;
  if (typeof window !== "undefined" && isDevGateHost(window.location.hostname)) return true;
  return false;
}

export function getDevGatePasswordHash(): string {
  return (import.meta.env.VITE_DEV_GATE_PASSWORD_HASH as string | undefined)?.trim().toLowerCase() ?? "";
}

export function isDevGateHashUsable(hash: string = getDevGatePasswordHash()): boolean {
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  if (hash === DEV_GATE_PUBLISHED_EXAMPLE_HASH) return false;
  return true;
}

function consumeDevGateAttempt(): boolean {
  const now = Date.now();
  attemptTimestamps = attemptTimestamps.filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (attemptTimestamps.length >= ATTEMPT_MAX) return false;
  attemptTimestamps.push(now);
  return true;
}

export function hasDevGateUnlock(): boolean {
  try {
    return sessionStorage.getItem(DEV_GATE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDevGateUnlocked(): void {
  try {
    sessionStorage.setItem(DEV_GATE_SESSION_KEY, "1");
  } catch {
    /* private mode — unlock lasts for this page load only via caller state */
  }
}

export function clearDevGateUnlock(): void {
  try {
    sessionStorage.removeItem(DEV_GATE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type DevGateVerifyResult =
  | { ok: true }
  | { ok: false; reason: "misconfigured" | "invalid" | "rate_limited" };

export async function verifyDevGatePassword(password: string): Promise<DevGateVerifyResult> {
  const expected = getDevGatePasswordHash();
  if (!isDevGateHashUsable(expected)) {
    return { ok: false, reason: "misconfigured" };
  }
  if (!consumeDevGateAttempt()) {
    return { ok: false, reason: "rate_limited" };
  }
  const got = await sha256Hex(password);
  if (got !== expected) return { ok: false, reason: "invalid" };
  return { ok: true };
}
