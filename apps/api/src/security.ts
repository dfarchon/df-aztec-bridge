import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

export const API_AUTH_MIN_LEN = 32;

export function parseCorsOrigins(raw: string | undefined = process.env.CORS_ORIGINS): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * POST /v1/claim accepts L2 secrets — only for explicit local API claim.
 * Requires API_ENABLE_CLAIM=true and loopback bind (API_HOST). Never enable on a
 * publicly reachable API; prefer VITE_ENABLE_BROWSER_CLAIM for static deploys.
 */
export function isClaimEndpointEnabled(env: NodeJS.ProcessEnv = process.env): {
  ok: true;
} | { ok: false; error: string; status: 403 } {
  if (env.API_ENABLE_CLAIM !== "true") {
    return {
      ok: false,
      status: 403,
      error:
        "HTTP L2 claim is disabled. Set API_ENABLE_CLAIM=true for local loopback use, or use browser claim (VITE_ENABLE_BROWSER_CLAIM=true) / CLI.",
    };
  }
  const host = (env.API_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  if (!isLoopbackHost(host)) {
    return {
      ok: false,
      status: 403,
      error:
        "HTTP L2 claim refuses non-loopback API_HOST (accepts l2SecretKey). Bind 127.0.0.1 or use browser claim / CLI.",
    };
  }
  return { ok: true };
}

export function requireApiAuthToken(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; token: string } | { ok: false; error: string } {
  const token = env.API_AUTH_TOKEN?.trim() ?? "";
  if (!token) {
    return {
      ok: false,
      error:
        "API_AUTH_TOKEN is required (min 32 chars). Generate with: openssl rand -hex 32",
    };
  }
  if (token.length < API_AUTH_MIN_LEN) {
    return {
      ok: false,
      error: `API_AUTH_TOKEN must be at least ${API_AUTH_MIN_LEN} characters`,
    };
  }
  return { ok: true, token };
}

function extractBearerOrApiKey(c: Context): string {
  const auth = c.req.header("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return c.req.header("x-api-key")?.trim() ?? "";
}

function safeEqualUtf8(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Auth for all /v1/* routes. /health stays public for local probes. */
export function createApiAuthMiddleware(expectedToken: string) {
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    if (path === "/health" || path === "/") {
      await next();
      return;
    }
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }
    const provided = extractBearerOrApiKey(c);
    if (!provided || !safeEqualUtf8(provided, expectedToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

export function applyApiSecurityHeaders(c: Context): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
}

export function createSecurityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    applyApiSecurityHeaders(c);
    await next();
    applyApiSecurityHeaders(c);
  };
}

/**
 * Rate-limit identity.
 * - Default: TCP peer address (never trust spoofable XFF).
 * - API_TRUST_PROXY=true: use X-Forwarded-For / X-Real-IP from a trusted reverse proxy.
 */
export function peerAddress(c: {
  req: { header: (name: string) => string | undefined };
  env?: { incoming?: { socket?: { remoteAddress?: string } } };
}): string | undefined {
  const addr = c.env?.incoming?.socket?.remoteAddress?.trim();
  return addr || undefined;
}

export function clientKey(
  c: {
    req: { header: (name: string) => string | undefined };
    env?: { incoming?: { socket?: { remoteAddress?: string } } };
  },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trustProxy = env.API_TRUST_PROXY === "true";
  let raw = peerAddress(c) || "local";
  if (trustProxy) {
    raw =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip")?.trim() ||
      peerAddress(c) ||
      "local";
  }
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function redactSecrets(input: string): string {
  return input
    .replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP_REDACTED]")
    .replace(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi, "[IP_REDACTED]");
}
