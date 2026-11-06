/**
 * Preview-host checks and cookie crypto shared by the Netlify edge gate and unit tests.
 * The password never goes into the client bundle. Netlify injects DEV_GATE_PASSWORD at the edge.
 */

export const PRODUCTION_KIT_HOST = "aztec-dfarchon-kit.netlify.app";
export const PREVIEW_COOKIE = "df_preview_gate";
export const PREVIEW_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

export function isPreviewGateHost(hostname) {
  const h = String(hostname ?? "").trim().toLowerCase();
  if (!h || h === PRODUCTION_KIT_HOST || h === "localhost" || h === "127.0.0.1") return false;
  if (h.endsWith(`--${PRODUCTION_KIT_HOST}`)) return true;
  if (h.endsWith(`.${PRODUCTION_KIT_HOST}`)) return true;
  return false;
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function passwordMatches(given, expected) {
  const [a, b] = await Promise.all([sha256Hex(String(given)), sha256Hex(String(expected))]);
  return timingSafeEqual(a, b);
}

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signPreviewCookie(password, host, exp) {
  const payload = `${host}|${exp}`;
  const sig = await hmacHex(password, payload);
  return `${exp}.${sig}`;
}

export async function verifyPreviewCookie(password, host, token, now) {
  const match = /^(\d+)\.([0-9a-f]+)$/.exec(String(token ?? ""));
  if (!match) return false;
  const exp = Number(match[1]);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const expected = await hmacHex(password, `${host}|${exp}`);
  return timingSafeEqual(expected, match[2]);
}

export function readCookie(header, name) {
  const parts = String(header ?? "").split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}
