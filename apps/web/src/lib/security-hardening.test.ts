import { describe, expect, it } from "vitest";
import { assertSafeClaimApiBase, isLoopbackApiBase } from "./api-base.ts";
import { readFileSync } from "node:fs";
import { buildDevCsp, buildProductionCsp } from "./csp.ts";

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

  it("keeps multi-tenant dRPC out of the production connect-src", () => {
    expect(buildProductionCsp()).not.toContain("lb.drpc.live");
    expect(buildDevCsp({ unsafeInlineScripts: false })).not.toContain("lb.drpc.live");
  });
});

describe("preview gate is not a client secret", () => {
  it("does not read a preview password hash into the app", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const gate = readFileSync(new URL("./dev-gate.ts", import.meta.url), "utf8");
    expect(main + gate).not.toContain("VITE_DEV_GATE_PASSWORD_HASH");
    const networks = readFileSync(new URL("../config/networks.ts", import.meta.url), "utf8");
    expect(networks).not.toContain("import.meta.env as");
    expect(networks).not.toContain("import.meta.env[");
  });
});
