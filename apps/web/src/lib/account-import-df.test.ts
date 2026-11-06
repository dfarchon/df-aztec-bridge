import { describe, expect, it } from "vitest";
import {
  accountFromNulo,
  accountFromV6Wallet,
  assertDfClientAccount,
  isNuloWalletName,
  parseAccountUpload,
} from "./account-import.ts";
import { isBridgeReadyDfPxeAccount } from "./df-pxe-bridge-guard.ts";

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

  it("marks a created 6.0 wallet ready to bridge", () => {
    const eth = "0x" + "ab".repeat(20);
    const account = accountFromV6Wallet(
      {
        address: "0x" + "11".repeat(32),
        secretKey: "0x" + "22".repeat(32),
        salt: "0x" + "33".repeat(32),
        signingKey: "0x" + "44".repeat(32),
        createdAt: 1,
        label: "Aztec 6.0 wallet",
      },
      eth,
    );
    expect(account.label).toBe("Aztec 6.0 wallet");
    expect(account.pxeRegistered).toBe(true);
    expect(isBridgeReadyDfPxeAccount(account, eth)).toBe(true);
  });

  it("marks a Nulo session ready to bridge without a signing key", () => {
    const eth = "0x" + "ab".repeat(20);
    const account = accountFromNulo("0x" + "11".repeat(32), eth);
    expect(isNuloWalletName("Nulo Wallet")).toBe(true);
    expect(isNuloWalletName("MetaMask")).toBe(false);
    expect(account.connector).toBe("nulo");
    expect(account.signingKey).toBeUndefined();
    expect(isBridgeReadyDfPxeAccount(account, eth)).toBe(true);
    expect(isBridgeReadyDfPxeAccount(account, "0x" + "00".repeat(20))).toBe(false);
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
