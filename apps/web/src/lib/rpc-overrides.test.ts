import { describe, expect, it } from "vitest";
import { isSafeConfiguredRpcUrl } from "./official-links.ts";
import { hasRpcOverrides, isAllowedRpcOverrideUrl, validateRpcOverrides } from "./rpc-overrides.ts";

describe("rpc-overrides allowlist", () => {
  it("allows pinned public, dRPC mainnet, and loopback URLs", () => {
    expect(isAllowedRpcOverrideUrl("https://aztec-mainnet.drpc.org")).toBe(true);
    expect(isAllowedRpcOverrideUrl("https://aztec-mainnet.drpc.org/")).toBe(true);
    expect(isAllowedRpcOverrideUrl("https://lb.drpc.live/aztec-mainnet/example_key-123")).toBe(true);
    expect(isAllowedRpcOverrideUrl("https://lb.drpc.live/aztec-testnet/x")).toBe(false);
    expect(isAllowedRpcOverrideUrl("https://lb.drpc.live/aztec-mainnet/x?key=y")).toBe(false);
    expect(isAllowedRpcOverrideUrl("https://lb.drpc.live/aztec-mainnet/x/extra")).toBe(false);
    expect(isAllowedRpcOverrideUrl("https://aztec-mainnet.drpc.org/keyed")).toBe(false);
    expect(isAllowedRpcOverrideUrl("https://aztecscan.xyz")).toBe(false);
    expect(isAllowedRpcOverrideUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedRpcOverrideUrl("https://evil.drpc.org")).toBe(false);
    expect(isAllowedRpcOverrideUrl("https://attacker.example")).toBe(false);
  });

  it("validateRpcOverrides rejects unlisted hosts", () => {
    expect(validateRpcOverrides({ aztecNodeUrl: "https://evil.drpc.org" })).toMatch(/pinned|blocked/i);
    expect(validateRpcOverrides({ aztecNodeUrl: "https://lb.drpc.live/aztec-mainnet/x" })).toBeNull();
    expect(validateRpcOverrides({ aztecNodeUrl: "https://aztec-mainnet.drpc.org" })).toBeNull();
  });

  it("accepts dRPC mainnet in build-time configuration", () => {
    expect(isSafeConfiguredRpcUrl("https://lb.drpc.live/aztec-mainnet/example_key-123")).toBe(true);
    expect(isSafeConfiguredRpcUrl("https://lb.drpc.live/other/example")).toBe(false);
  });

  it("hasRpcOverrides ignores leftover L1 URLs", () => {
    expect(hasRpcOverrides({ l1RpcUrl: "https://ethereum-rpc.publicnode.com" })).toBe(false);
    expect(hasRpcOverrides({ aztecNodeUrl: "https://aztec-mainnet.drpc.org" })).toBe(true);
  });
});
