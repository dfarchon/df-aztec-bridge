import { describe, expect, it } from "vitest";
import { describePortalBatchConfirm } from "./bridge.ts";

describe("describePortalBatchConfirm", () => {
  it("lists only the calls that are in this wallet confirm", () => {
    expect(
      describePortalBatchConfirm({ ethServiceFee: true, aztecFee: true, approve: true }),
    ).toBe("Confirm in your wallet: ETH service fee, 5% AZTEC fee, Fee Juice approval, and the L1 deposit.");
    expect(
      describePortalBatchConfirm({ ethServiceFee: true, aztecFee: false, approve: false }),
    ).toBe("Confirm in your wallet: ETH service fee and the L1 deposit.");
    expect(
      describePortalBatchConfirm({ ethServiceFee: false, aztecFee: true, approve: true }),
    ).toBe("Confirm in your wallet: 5% AZTEC fee, Fee Juice approval, and the L1 deposit.");
  });

  it("describes a deposit-only confirm without a batch list", () => {
    expect(
      describePortalBatchConfirm({ ethServiceFee: false, aztecFee: false, approve: false }),
    ).toBe("Confirm the L1 deposit in your wallet.");
  });
});
