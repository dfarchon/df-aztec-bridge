import { describe, expect, it } from "vitest";
import { assertSafeClaimApiBase, isLoopbackApiBase } from "./api-base.ts";
import { buildProductionCsp } from "./csp.ts";
import {
  DEV_GATE_PUBLISHED_EXAMPLE_HASH,
  isDevGateHashUsable,
} from "./dev-gate.ts";

describe("api-base", () => {
  it("allows /api and loopback only", () => {
    expect(isLoopbackApiBase("/api")).toBe(true);
    expect(isLoopbackApiBase("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackApiBase("http://localhost:8787")).toBe(true);
    expect(isLoopbackApiBase("https://api.example.com")).toBe(false);
    expect(() => assertSafeClaimApiBase("https://api.example.com")).toThrow(/Remote API claim/);
  });
});

describe("csp", () => {
  it("does not allow open https: / wss: connect-src", () => {
    const csp = buildProductionCsp();
    // Scheme-only sources (not https://host) must not appear in connect-src.
    expect(csp).not.toMatch(/connect-src[^;]*\shttps:(?:\s|;|$)/);
    expect(csp).not.toMatch(/connect-src[^;]*\swss:(?:\s|;|$)/);
    expect(csp).toContain("https://aztec-mainnet.drpc.org");
    expect(csp).toContain("wss://*.walletconnect.com");
    expect(csp).not.toContain("https://*.drpc.org");
    expect(csp).not.toContain("https://*.publicnode.com");
    expect(csp).not.toContain("fonts.googleapis.com");
    expect(csp).not.toContain("fonts.gstatic.com");
    expect(csp).toContain("font-src 'self' data:");
  });

  it("allows Aztec CRS hosts required for browser proving", () => {
    const csp = buildProductionCsp();
    expect(csp).toContain("https://crs.aztec-cdn.foundation");
    expect(csp).toContain("https://crs.aztec-labs.com");
  });
});

describe("dev-gate hash policy", () => {
  it("rejects published example hash", () => {
    expect(isDevGateHashUsable(DEV_GATE_PUBLISHED_EXAMPLE_HASH)).toBe(false);
    expect(isDevGateHashUsable("a".repeat(64))).toBe(true);
  });
});
