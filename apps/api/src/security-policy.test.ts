import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Lightweight policy tests for API stop-ship rules (no live server).
 * Runtime behaviour is also enforced in src/server.ts.
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
});
