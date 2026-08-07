import { describe, expect, it } from "vitest";
import {
  assertDfClientAccount,
  parseAccountUpload,
} from "./account-import.ts";

describe("DF client account import", () => {
  it("parses dfpunk-account JSON with signingKey", () => {
    const [a] = parseAccountUpload({
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x" + "33".repeat(32),
      signingKey: "44".repeat(32),
      createdAt: 1,
    });
    expect(a.fromDfClient).toBe(true);
    expect(a.signingKey).toMatch(/^0x/);
    expect(() => assertDfClientAccount(a)).not.toThrow();
  });

  it("parses Quick Join dark-forest-privacy shape", () => {
    const [a] = parseAccountUpload({
      address: "0x" + "aa".repeat(32),
      secretKey: "0x" + "bb".repeat(32),
      salt: "0x0",
      signingKey: "0x" + "cc".repeat(32),
      homeCoordinates: { x: 1, y: 2 },
    });
    expect(a.label).toMatch(/Quick Join/i);
  });

  it("rejects DF import without signingKey", () => {
    const [a] = parseAccountUpload({
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x0",
    });
    expect(() => assertDfClientAccount(a)).toThrow(/signingKey/i);
  });
});
