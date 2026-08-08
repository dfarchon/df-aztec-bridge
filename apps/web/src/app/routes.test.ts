import { describe, expect, it } from "vitest";
import {
  isExplorerPath,
  normalizePath,
  parseExplorerRoute,
  ROUTES,
} from "./routes.ts";

describe("explorer routes", () => {
  it("parses AztecScan-shaped local paths", () => {
    expect(parseExplorerRoute("/explorer")).toEqual({ kind: "index" });
    expect(parseExplorerRoute("/blocks/42")).toEqual({
      kind: "block",
      blockNumber: 42,
    });
    expect(parseExplorerRoute("/tx-effects/0xabc")).toEqual({
      kind: "txEffect",
      txHash: "0xabc",
    });
    expect(parseExplorerRoute("/address/aztec:foo")).toEqual({
      kind: "address",
      address: "aztec:foo",
    });
    expect(parseExplorerRoute("/bridge")).toBeNull();
  });

  it("keeps explorer paths in normalizePath", () => {
    expect(normalizePath("/explorer")).toBe(ROUTES.explorer);
    expect(normalizePath("/blocks/1/")).toBe("/blocks/1");
    expect(normalizePath("/tx-effects/0xdead")).toBe("/tx-effects/0xdead");
    expect(normalizePath("/unknown")).toBe(ROUTES.bridge);
    expect(isExplorerPath("/blocks/3")).toBe(true);
    expect(isExplorerPath("/bridge")).toBe(false);
  });
});
