import { describe, expect, it } from "vitest";
import {
  aztecWalletCompatShortLabel,
  aztecWalletCompatWarning,
  isAztecWalletBridgeSafe,
  walletCompatFromRegisterStyle,
} from "./aztec-wallet-compat.ts";

describe("aztec wallet compat labels", () => {
  it("marks only 6.0 styles as bridge-safe", () => {
    expect(isAztecWalletBridgeSafe("v6-initializerless")).toBe(true);
    expect(isAztecWalletBridgeSafe("v6-schnorr")).toBe(true);
    expect(isAztecWalletBridgeSafe("v6-external")).toBe(true);
    expect(isAztecWalletBridgeSafe("pre-v6")).toBe(false);
    expect(isAztecWalletBridgeSafe("unknown")).toBe(false);
    expect(isAztecWalletBridgeSafe(undefined)).toBe(false);
  });

  it("maps register styles and warns on pre-v6", () => {
    expect(walletCompatFromRegisterStyle("schnorr_initializerless")).toBe("v6-initializerless");
    expect(walletCompatFromRegisterStyle("schnorr")).toBe("v6-schnorr");
    expect(aztecWalletCompatShortLabel("pre-v6")).toBe("v5 / v5.1");
    expect(aztecWalletCompatWarning("pre-v6")).toMatch(/do not bridge/i);
    expect(aztecWalletCompatWarning("v6-initializerless")).toBeNull();
  });
});
