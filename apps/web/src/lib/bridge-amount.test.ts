import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import {
  bridgeShortfall,
  MIN_BRIDGE_FJ,
  MIN_BRIDGE_WEI,
  parseBridgeAmount,
} from "./bridge-amount.js";

const fj = (value: string) => parseUnits(value, 18);

describe("parseBridgeAmount", () => {
  it("accepts the minimum and anything above it", () => {
    expect(parseBridgeAmount(String(MIN_BRIDGE_FJ))).toEqual({ wei: MIN_BRIDGE_WEI, error: null });
    expect(parseBridgeAmount("1000").wei).toBe(fj("1000"));
    expect(parseBridgeAmount("  3.5  ").wei).toBe(fj("3.5"));
  });

  it("rejects amounts below the minimum", () => {
    for (const input of ["0", "1", "2.999999999999999999"]) {
      const result = parseBridgeAmount(input);
      expect(result.wei).toBeNull();
      expect(result.error).toContain(`${MIN_BRIDGE_FJ} FJ`);
    }
  });

  it("rejects empty and malformed input without throwing", () => {
    expect(parseBridgeAmount("").error).toMatch(/enter an amount/i);
    for (const input of ["abc", "3,5", "-4", "1e21", "3.", ".5"]) {
      const result = parseBridgeAmount(input);
      expect(result.wei).toBeNull();
      expect(result.error).toBeTruthy();
    }
  });

  it("rejects more than 18 decimals rather than silently rounding", () => {
    expect(parseBridgeAmount("3.0000000000000000001").wei).toBeNull();
  });
});

describe("bridgeShortfall", () => {
  it("returns null when the balance covers the deposit", () => {
    expect(bridgeShortfall(fj("3"), fj("3"))).toBeNull();
    expect(bridgeShortfall(fj("3"), fj("10"))).toBeNull();
  });

  it("reports the missing amount with trailing zeros trimmed", () => {
    const gap = bridgeShortfall(fj("10"), fj("2.5"));
    expect(gap?.missingFormatted).toBe("7.5");
    expect(gap?.neededFormatted).toBe("10");
    expect(gap?.haveFormatted).toBe("2.5");
    expect(gap?.missing).toBe(fj("7.5"));
  });

  it("handles an empty wallet", () => {
    const gap = bridgeShortfall(fj("3"), 0n);
    expect(gap?.haveFormatted).toBe("0");
    expect(gap?.missingFormatted).toBe("3");
  });
});
