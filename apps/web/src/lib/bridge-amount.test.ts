import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import {
  amountFromPercent,
  amountFromSlider,
  amountPresets,
  AMOUNT_SLIDER_MAX,
  formatSliderAmount,
  bridgeShortfall,
  isDraftAmountInput,
  MIN_BRIDGE_FJ,
  MIN_BRIDGE_WEI,
  parseAmountWeiLoose,
  parseBridgeAmount,
  sanitizeAmountInput,
  sliderFromAmount,
} from "./bridge-amount.ts";

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

describe("isDraftAmountInput", () => {
  it("treats empty and trailing-dot values as drafts", () => {
    expect(isDraftAmountInput("")).toBe(true);
    expect(isDraftAmountInput("   ")).toBe(true);
    expect(isDraftAmountInput("3.")).toBe(true);
    expect(isDraftAmountInput("3.5")).toBe(false);
    expect(isDraftAmountInput("3")).toBe(false);
  });
});

describe("sanitizeAmountInput", () => {
  it("keeps digits and a single decimal, capping at 18 places", () => {
    expect(sanitizeAmountInput("12.34abc")).toBe("12.34");
    expect(sanitizeAmountInput("3.1.4")).toBe("3.14");
    expect(sanitizeAmountInput(".5")).toBe("0.5");
    expect(sanitizeAmountInput(`3.${"1".repeat(20)}`)).toBe(`3.${"1".repeat(18)}`);
  });
});

describe("parseAmountWeiLoose", () => {
  it("reads trailing-dot drafts as whole numbers", () => {
    expect(parseAmountWeiLoose("")).toBeNull();
    expect(parseAmountWeiLoose("3.")).toBe(fj("3"));
    expect(parseAmountWeiLoose("3.5")).toBe(fj("3.5"));
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

describe("amount presets and slider", () => {
  it("computes percent and slider amounts from the full balance", () => {
    const balance = fj("400");
    expect(amountFromPercent(balance, 25)).toBe(fj("100"));
    expect(amountFromPercent(balance, 100)).toBe(balance);
    expect(amountFromSlider(balance, 0)).toBe(0n);
    expect(amountFromSlider(balance, AMOUNT_SLIDER_MAX)).toBe(balance);
    expect(amountFromSlider(balance, AMOUNT_SLIDER_MAX / 2)).toBe(fj("200"));
    expect(sliderFromAmount(balance, fj("100"))).toBe(2_500);
    expect(sliderFromAmount(balance, fj("500"))).toBe(AMOUNT_SLIDER_MAX);
    expect(sliderFromAmount(0n, fj("1"))).toBe(0);
  });

  it("disables presets below the minimum bridge amount", () => {
    const small = amountPresets(fj("8"));
    expect(small.map((row) => [row.label, row.disabled, row.amountFj])).toEqual([
      ["25%", true, "2"],
      ["50%", false, "4"],
      ["75%", false, "6"],
      ["Max", false, "8"],
    ]);
    expect(amountPresets(fj("2")).every((row) => row.disabled)).toBe(true);
  });

  it("floors slider amounts to 4 decimals without rounding up", () => {
    expect(formatSliderAmount(fj("1852.98078123"))).toBe("1852.9807");
    expect(formatSliderAmount(fj("100"))).toBe("100");
    expect(formatSliderAmount(fj("0.123456"))).toBe("0.1234");
  });
});
