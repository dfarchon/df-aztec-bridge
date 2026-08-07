import { describe, expect, it } from "vitest";
import { parseClaimCredentialsFile } from "./claim-credentials-import.ts";

const L1_TX = "0xAABBCCDDeeff00112233445566778899aabbccddeeff00112233445566778899";
const credentials = {
  claimSecret: "0x1111111111111111111111111111111111111111111111111111111111111111",
  claimSecretHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
  messageHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
  messageLeafIndex: "7",
  claimAmount: "500000000000000000",
  recipient: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
};

describe("parseClaimCredentialsFile", () => {
  it("reads the download payload this app writes", () => {
    const parsed = parseClaimCredentialsFile({
      recipient: credentials.recipient,
      credentials,
      l1TxHash: L1_TX,
      networkId: "mainnet",
    });
    expect(parsed.credentials).toEqual(credentials);
    expect(parsed.recipient).toBe(credentials.recipient);
    expect(parsed.networkId).toBe("mainnet");
  });

  it("lowercases the L1 hash so it matches the store key", () => {
    expect(parseClaimCredentialsFile({ credentials, l1TxHash: L1_TX }).l1TxHash).toBe(
      L1_TX.toLowerCase(),
    );
  });

  it("reads the CLI run output shape", () => {
    const parsed = parseClaimCredentialsFile({
      aztecAddress: credentials.recipient,
      claimCredentials: credentials,
      l1TxHash: L1_TX,
    });
    expect(parsed.credentials).toEqual(credentials);
    expect(parsed.recipient).toBe(credentials.recipient);
  });

  it("reads a bare ClaimCredentials object carrying its own l1TxHash", () => {
    const parsed = parseClaimCredentialsFile({ ...credentials, l1TxHash: L1_TX });
    expect(parsed.credentials).toEqual(credentials);
  });

  it("falls back to the recipient inside the credentials", () => {
    expect(parseClaimCredentialsFile({ credentials, l1TxHash: L1_TX }).recipient).toBe(
      credentials.recipient,
    );
  });

  it("refuses a file with no L1 tx hash to key it by", () => {
    expect(() => parseClaimCredentialsFile({ recipient: credentials.recipient, credentials })).toThrow(
      /no l1TxHash/i,
    );
  });

  it("refuses a malformed L1 tx hash", () => {
    expect(() => parseClaimCredentialsFile({ credentials, l1TxHash: "0x1234" })).toThrow(
      /32-byte hex/i,
    );
  });

  it("refuses non-objects and unrelated JSON", () => {
    for (const input of [null, 42, "text", [], {}, { credentials: { foo: 1 } }]) {
      expect(() => parseClaimCredentialsFile(input)).toThrow();
    }
  });

  it("refuses credentials with a tampered secret", () => {
    expect(() =>
      parseClaimCredentialsFile({
        credentials: { ...credentials, claimSecret: "0xdeadbeef" },
        l1TxHash: L1_TX,
      }),
    ).toThrow(/claim credentials file/i);
  });
});
