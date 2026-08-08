import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import {
  clientKey,
  createApiAuthMiddleware,
  createSecurityHeadersMiddleware,
  isClaimEndpointEnabled,
  parseCorsOrigins,
  requireApiAuthToken,
} from "./security.ts";
import { createApp } from "./app.ts";

/**
 * Lightweight policy tests for API stop-ship rules (no live claim pipeline).
 */

const FORBIDDEN_BRIDGE_MESSAGE =
  "HTTP L1 bridging is disabled. Use the CLI (`pnpm cli`) or the web wallet flow. Do not send L1 private keys to the API.";

describe("API security policy", () => {
  it("documents that HTTP L1 bridge is forbidden", () => {
    assert.match(FORBIDDEN_BRIDGE_MESSAGE, /disabled/i);
    assert.match(FORBIDDEN_BRIDGE_MESSAGE, /L1 private keys/i);
  });

  it("requires hex-64 secrets shape", () => {
    const HEX_64 = /^0x[0-9a-fA-F]{64}$/;
    assert.equal(HEX_64.test("0x" + "ab".repeat(32)), true);
    assert.equal(HEX_64.test("0x1234"), false);
    assert.equal(HEX_64.test("ab".repeat(32)), false);
  });

  it("rejects non-https remote RPC schemes", () => {
    function isRpcUrlSchemeAllowed(url: string): boolean {
      try {
        const u = new URL(url);
        if (u.protocol === "https:") return true;
        if (u.protocol !== "http:") return false;
        const host = u.hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1";
      } catch {
        return false;
      }
    }
    assert.equal(isRpcUrlSchemeAllowed("https://example.com"), true);
    assert.equal(isRpcUrlSchemeAllowed("http://127.0.0.1:8545"), true);
    assert.equal(isRpcUrlSchemeAllowed("http://evil.example"), false);
  });

  it("requires API_AUTH_TOKEN of sufficient length", () => {
    assert.equal(requireApiAuthToken({}).ok, false);
    assert.equal(requireApiAuthToken({ API_AUTH_TOKEN: "short" }).ok, false);
    const ok = requireApiAuthToken({ API_AUTH_TOKEN: "a".repeat(32) });
    assert.equal(ok.ok, true);
  });

  it("disables claim unless API_ENABLE_CLAIM on loopback", () => {
    assert.equal(isClaimEndpointEnabled({}).ok, false);
    assert.equal(isClaimEndpointEnabled({ API_ENABLE_CLAIM: "true", API_HOST: "0.0.0.0" }).ok, false);
    assert.equal(isClaimEndpointEnabled({ API_ENABLE_CLAIM: "true", API_HOST: "127.0.0.1" }).ok, true);
  });

  it("createApp: bridge always 403; claim 403 without API_ENABLE_CLAIM", async () => {
    const prevClaim = process.env.API_ENABLE_CLAIM;
    const prevHost = process.env.API_HOST;
    delete process.env.API_ENABLE_CLAIM;
    process.env.API_HOST = "127.0.0.1";
    try {
      const token = "c".repeat(32);
      const app = createApp({ authToken: token });
      const bridge = await app.request("/v1/bridge", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(bridge.status, 403);

      const claim = await app.request("/v1/claim", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(claim.status, 403);
      const body = (await claim.json()) as { error?: string };
      assert.match(body.error ?? "", /API_ENABLE_CLAIM|disabled/i);
    } finally {
      if (prevClaim === undefined) delete process.env.API_ENABLE_CLAIM;
      else process.env.API_ENABLE_CLAIM = prevClaim;
      if (prevHost === undefined) delete process.env.API_HOST;
      else process.env.API_HOST = prevHost;
    }
  });

  it("parses CORS origins allowlist", () => {
    assert.deepEqual(parseCorsOrigins(undefined), []);
    assert.deepEqual(parseCorsOrigins(" http://localhost:5173 , https://a.example "), [
      "http://localhost:5173",
      "https://a.example",
    ]);
  });

  it("ignores X-Forwarded-For unless API_TRUST_PROXY=true; uses peer when present", () => {
    const c = {
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? "203.0.113.9" : undefined),
      },
      env: { incoming: { socket: { remoteAddress: "198.51.100.7" } } },
    };
    const untrusted = clientKey(c, {});
    const alsoPeer = clientKey(c, { API_TRUST_PROXY: "false" });
    assert.equal(untrusted, alsoPeer);
    const trusted = clientKey(c, { API_TRUST_PROXY: "true" });
    assert.notEqual(trusted, untrusted);
    const noPeer = {
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? "203.0.113.9" : undefined),
      },
    };
    const localFallback = clientKey(noPeer, {});
    assert.equal(localFallback, clientKey(noPeer, { API_TRUST_PROXY: "false" }));
  });

  it("rejects missing/wrong auth on /v1 and allows /health", async () => {
    const token = "t".repeat(32);
    const app = new Hono();
    app.use("/*", createApiAuthMiddleware(token));
    app.get("/health", (c) => c.json({ ok: true }));
    app.get("/v1/networks", (c) => c.json({ networks: [] }));
    app.post("/v1/claim", (c) => c.json({ jobId: "ok" }, 202));

    const health = await app.request("/health");
    assert.equal(health.status, 200);

    const denied = await app.request("/v1/networks");
    assert.equal(denied.status, 401);

    const claimDenied = await app.request("/v1/claim", { method: "POST" });
    assert.equal(claimDenied.status, 401);

    const wrong = await app.request("/v1/networks", {
      headers: { Authorization: "Bearer wrong" },
    });
    assert.equal(wrong.status, 401);

    const okBearer = await app.request("/v1/networks", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(okBearer.status, 200);

    const claimOk = await app.request("/v1/claim", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(claimOk.status, 202);

    const okKey = await app.request("/v1/networks", {
      headers: { "X-API-Key": token },
    });
    assert.equal(okKey.status, 200);
  });

  it("applies security headers on responses", async () => {
    const app = new Hono();
    app.use("/*", createSecurityHeadersMiddleware());
    app.get("/health", (c) => c.json({ ok: true }));
    const res = await app.request("/health");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.match(res.headers.get("Content-Security-Policy") ?? "", /default-src 'none'/);
  });
});
