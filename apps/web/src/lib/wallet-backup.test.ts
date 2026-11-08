import { describe, expect, it } from "vitest";
import { parseAccountUpload } from "./account-import.ts";
import {
  parseAztecWalletTxt,
  serializeAztecWalletJson,
  serializeAztecWalletTxt,
  serializeEthWalletTxt,
  withVerifiedV6Address,
} from "./wallet-backup.ts";

describe("wallet-backup txt", () => {
  it("round-trips an Aztec dfpunk account", () => {
    const account = {
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x" + "33".repeat(32),
      signingKey: "0x" + "44".repeat(32),
      createdAt: 1,
      label: "test",
    };
    const txt = serializeAztecWalletTxt(account, { networkId: "mainnet" });
    expect(txt).toContain("type=dfpunk-aztec");
    expect(txt).toContain("secretKey=");
    const parsed = parseAztecWalletTxt(txt);
    expect(parsed.address).toBe(account.address);
    expect(parsed.secretKey).toBe(account.secretKey);
    expect(parsed.salt).toBe(account.salt);
    expect(parsed.signingKey).toBe(account.signingKey);
  });

  it("serializes ethereum address snapshot without secrets", () => {
    const txt = serializeEthWalletTxt({
      address: "0xabc",
      chainId: 1,
      walletName: "MetaMask",
      networkId: "mainnet",
    });
    expect(txt).toContain("type=ethereum-connected");
    expect(txt).toContain("address=0xabc");
    expect(txt).not.toContain("secretKey");
  });

  it("exports JSON that DF account import can read back", () => {
    const account = {
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x" + "33".repeat(32),
      signingKey: "0x" + "44".repeat(32),
      createdAt: 12,
    };
    const json = serializeAztecWalletJson(account);
    expect(json).toEqual({
      address: account.address,
      secretKey: account.secretKey,
      salt: account.salt,
      signingKey: account.signingKey,
      createdAt: 12,
    });
    const [parsed] = parseAccountUpload(json);
    expect(parsed.address).toBe(account.address);
    expect(parsed.secretKey).toBe(account.secretKey);
    expect(parsed.salt).toBe(account.salt);
    expect(parsed.signingKey).toBe(account.signingKey);
  });

  it("rewrites only the address after a verified Aztec 6.0 check", () => {
    const account = {
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x" + "33".repeat(32),
      signingKey: "0x" + "44".repeat(32),
      createdAt: 9,
      label: "old",
    };
    const next = "0x" + "ab".repeat(32);
    const rebased = withVerifiedV6Address(account, next);
    expect(rebased.address).toBe(next);
    expect(rebased.secretKey).toBe(account.secretKey);
    expect(rebased.salt).toBe(account.salt);
    expect(rebased.signingKey).toBe(account.signingKey);
    expect(rebased.createdAt).toBe(9);
    expect(serializeAztecWalletJson(rebased)).toEqual({
      address: next,
      secretKey: account.secretKey,
      salt: account.salt,
      signingKey: account.signingKey,
      createdAt: 9,
    });
  });

  it("refuses a v6 backup when the address did not change or is invalid", () => {
    const account = {
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x" + "33".repeat(32),
      signingKey: "0x" + "44".repeat(32),
    };
    expect(() => withVerifiedV6Address(account, account.address)).toThrow(/already match/);
    expect(() => withVerifiedV6Address(account, "0x1234")).toThrow(/failed validation/);
    expect(() =>
      withVerifiedV6Address({ ...account, signingKey: "" }, "0x" + "ab".repeat(32)),
    ).toThrow(/signingKey/);
  });

  it("parses JSON dfpunk payloads", () => {
    const parsed = parseAztecWalletTxt(
      JSON.stringify({
        address: "0x" + "aa".repeat(32),
        secretKey: "0x" + "bb".repeat(32),
        salt: "0x0",
        signingKey: "0x" + "cc".repeat(32),
      }),
    );
    expect(parsed.address.startsWith("0x")).toBe(true);
  });
});
