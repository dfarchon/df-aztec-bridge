import { describe, expect, it } from "vitest";
import { presentWalletError, WALLET_LOCKED_DETAIL } from "./wallet-error.ts";

const VIEM_LOCKED = [
  "An internal error was received.",
  "Request Arguments:",
  "chain: Ethereum (id: 1)",
  "from: 0x0000000000000000000000000000000000000001",
  "Details: KeyringController - The operation cannot be completed while the controller is locked.",
  "Version: viem@2.55.4",
].join("\n");

describe("presentWalletError", () => {
  it("replaces a locked MetaMask keyring dump with one instruction", () => {
    expect(presentWalletError(new Error(VIEM_LOCKED))).toBe(WALLET_LOCKED_DETAIL);
    expect(presentWalletError({ details: "KeyringController - The operation cannot be completed while the controller is locked." })).toBe(
      WALLET_LOCKED_DETAIL,
    );
  });

  it("keeps the viem detail line and drops the request dump", () => {
    const dumped = [
      "An internal error was received.",
      "Request Arguments:",
      "from: 0x0000000000000000000000000000000000000001",
      "Details: User rejected the request.",
      "Version: viem@2.55.4",
    ].join(" ");
    expect(presentWalletError(dumped)).toBe("User rejected the request.");
  });

  it("leaves ordinary messages unchanged", () => {
    expect(presentWalletError("Select a network first.")).toBe("Select a network first.");
    expect(presentWalletError(WALLET_LOCKED_DETAIL)).toBe(WALLET_LOCKED_DETAIL);
  });
});
