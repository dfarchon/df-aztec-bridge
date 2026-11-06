import { describe, expect, it } from "vitest";
import {
  ESTIMATED_CLAIM_FEE_WEI,
  parseEthFeeWeiOverride,
  predictBridgeReceipt,
  resolveBridgeEthServiceFee,
  shouldChargeBridgeEthServiceFee,
} from "./fee.ts";

describe("bridge receipt prediction", () => {
  it("predicts 1.20 FJ left from a 3 FJ bridge", () => {
    const three = 3n * 10n ** 18n;
    const receipt = predictBridgeReceipt(three);
    expect(receipt.protocolFee).toBe(15n * 10n ** 16n);
    expect(receipt.deposited).toBe(285n * 10n ** 16n);
    expect(receipt.claimFee).toBe(ESTIMATED_CLAIM_FEE_WEI);
    expect(receipt.receive).toBe(120n * 10n ** 16n);
  });

  it("predicts nothing left when the claim estimate exceeds the deposit", () => {
    const receipt = predictBridgeReceipt(1n * 10n ** 18n);
    expect(receipt.receive).toBe(0n);
  });
});

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
