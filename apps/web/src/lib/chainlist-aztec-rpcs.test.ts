import { describe, expect, it } from "vitest";
import {
  buildAztecRpcOptions,
  extractAztecHttpsRpcs,
  isSelectableAztecNodeUrl,
} from "./chainlist-aztec-rpcs.ts";

describe("chainlist-aztec-rpcs", () => {
  it("extracts https Aztec RPCs and drops wss", () => {
    const urls = extractAztecHttpsRpcs([
      {
        name: "Aztec Mainnet",
        chainId: 677868,
        rpc: [
          { url: "https://aztec-mainnet.drpc.org" },
          { url: "wss://aztec-mainnet.drpc.org" },
          "https://example-aztec.invalid/rpc",
        ],
      },
      { name: "Ethereum", chainId: 1, rpc: ["https://ethereum.example"] },
    ]);
    expect(urls).toContain("https://aztec-mainnet.drpc.org");
    expect(urls).toContain("https://example-aztec.invalid/rpc");
    expect(urls.some((u) => u.startsWith("wss:"))).toBe(false);
    expect(urls).not.toContain("https://ethereum.example");
  });

  it("rejects keyed template URLs", () => {
    expect(isSelectableAztecNodeUrl("https://rpc.example/${API_KEY}")).toBe(false);
    expect(isSelectableAztecNodeUrl("https://aztec-mainnet.drpc.org")).toBe(true);
  });

  it("puts current url first in options", () => {
    const opts = buildAztecRpcOptions({
      currentUrl: "https://custom.example/aztec",
      networkDefaultUrl: "https://aztec-mainnet.drpc.org",
      chainlistUrls: ["https://aztec-mainnet.drpc.org", "https://other.example"],
    });
    expect(opts[0]?.url).toBe("https://custom.example/aztec");
    expect(opts[0]?.source).toBe("current");
    expect(opts.map((o) => o.url)).toEqual([
      "https://custom.example/aztec",
      "https://aztec-mainnet.drpc.org",
      "https://other.example",
    ]);
  });
});
