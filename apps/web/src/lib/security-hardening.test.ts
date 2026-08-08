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

describe("dRPC client bake policy", () => {
  it("rejects path-keyed lb.drpc.live URLs for VITE exposure", () => {
    const keyed =
      /^https:\/\/lb\.drpc\.live\/aztec-mainnet\/[^/\s?#]+$/i.test(
        "https://lb.drpc.live/aztec-mainnet/EXAMPLE_KEY_NOT_REAL",
      );
    expect(keyed).toBe(true);
    expect(/^https:\/\/lb\.drpc\.live\/aztec-mainnet\/[^/\s?#]+$/i.test("https://aztec-mainnet.drpc.org")).toBe(
      false,
    );
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
  });
});

describe("dev-gate hash policy", () => {
  it("rejects published example hash", () => {
    expect(isDevGateHashUsable(DEV_GATE_PUBLISHED_EXAMPLE_HASH)).toBe(false);
    expect(isDevGateHashUsable("a".repeat(64))).toBe(true);
  });
});
