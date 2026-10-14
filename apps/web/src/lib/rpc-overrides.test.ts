import { describe, expect, it } from "vitest";
import { hasRpcOverrides, isAllowedRpcOverrideUrl, validateRpcOverrides } from "./rpc-overrides.ts";

describe("rpc-overrides allowlist", () => {
  it("allows official and loopback only", () => {
    expect(isAllowedRpcOverrideUrl("https://aztec-mainnet.drpc.org")).toBe(true);
    expect(isAllowedRpcOverrideUrl("https://lb.drpc.live/aztec-mainnet/x")).toBe(true);
    expect(isAllowedRpcOverrideUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedRpcOverrideUrl("https://evil.drpc.org")).toBe(false);
    expect(isAllowedRpcOverrideUrl("https://attacker.example")).toBe(false);
  });

  it("validateRpcOverrides rejects unlisted hosts", () => {
    expect(validateRpcOverrides({ aztecNodeUrl: "https://evil.drpc.org" })).toMatch(/allowlist/i);
    expect(validateRpcOverrides({ aztecNodeUrl: "https://aztec-mainnet.drpc.org" })).toBeNull();
  });

  it("hasRpcOverrides ignores leftover L1 URLs", () => {
    expect(hasRpcOverrides({ l1RpcUrl: "https://ethereum-rpc.publicnode.com" })).toBe(false);
    expect(hasRpcOverrides({ aztecNodeUrl: "https://aztec-mainnet.drpc.org" })).toBe(true);
  });
});
