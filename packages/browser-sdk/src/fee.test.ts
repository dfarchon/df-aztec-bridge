import { describe, expect, it } from "vitest";
import {
  parseEthFeeWeiOverride,
  resolveBridgeEthServiceFee,
  shouldChargeBridgeEthServiceFee,
} from "./fee.ts";

describe("bridge ETH service fee", () => {
  it("only charges on Ethereum mainnet", () => {
    expect(shouldChargeBridgeEthServiceFee(1)).toBe(true);
    expect(shouldChargeBridgeEthServiceFee(11155111)).toBe(false);
  });

  it("parses wei override", () => {
    expect(parseEthFeeWeiOverride("1000000000000000")).toBe(1_000_000_000_000_000n);
    expect(parseEthFeeWeiOverride("")).toBeNull();
    expect(parseEthFeeWeiOverride("0x1")).toBeNull();
  });

  it("uses override on mainnet and estimates from gas otherwise", async () => {
    const fixed = await resolveBridgeEthServiceFee({
      chainId: 1,
      overrideWei: 5n,
      getGasPrice: async () => 1_000_000_000n,
    });
    expect(fixed).toBe(5n);

    const estimated = await resolveBridgeEthServiceFee({
      chainId: 1,
      getGasPrice: async () => 2n,
    });
    expect(estimated).toBe(2n * 100_000n);

    const off = await resolveBridgeEthServiceFee({
      chainId: 11155111,
      overrideWei: 5n,
      getGasPrice: async () => 2n,
    });
    expect(off).toBe(0n);
  });
});
