import { describe, expect, it, vi } from "vitest";
import {
  assertL2ClaimReceiptOk,
  classifyWitnessLookupError,
  sendClaimThenWait,
} from "./claim-status.js";

describe("claim-status helpers", () => {
  it("classifies consumed witness errors", () => {
    expect(
      classifyWitnessLookupError(new Error("No non-nullified L1 to L2 message")),
    ).toBe("consumed");
    expect(classifyWitnessLookupError(new Error("network down"))).toBe("rethrow");
  });

  it("keeps credentials recoverable on revert/drop", () => {
    expect(() =>
      assertL2ClaimReceiptOk(
        {
          isDropped: () => true,
          hasExecutionReverted: () => false,
          status: "DROPPED",
        },
        "0xl2",
      ),
    ).toThrow(/dropped/);

    expect(() =>
      assertL2ClaimReceiptOk(
        {
          isDropped: () => false,
          hasExecutionReverted: () => true,
          status: "REVERTED",
        },
        "0xl2",
      ),
    ).toThrow(/reverted/);

    expect(
      assertL2ClaimReceiptOk(
        {
          isDropped: () => false,
          hasExecutionReverted: () => false,
          status: "PROPOSED",
        },
        "0xl2",
      ),
    ).toEqual({ l2TxHash: "0xl2", status: "PROPOSED" });
  });

  it("fires onTxSent before waitForTx", async () => {
    const order: string[] = [];
    const onTxSent = vi.fn((hash: string) => {
      order.push(`sent:${hash}`);
    });

    const result = await sendClaimThenWait({
      send: async () => {
        order.push("prove");
        return { txHash: "0xabc" };
      },
      onTxSent,
      wait: async (hash) => {
        order.push(`wait:${hash}`);
        return "mined";
      },
    });

    expect(result).toEqual({ l2TxHash: "0xabc", waitResult: "mined" });
    expect(onTxSent).toHaveBeenCalledWith("0xabc");
    expect(order).toEqual(["prove", "sent:0xabc", "wait:0xabc"]);
  });

  it("still persists onTxSent if wait throws (refresh mid-mining)", async () => {
    const onTxSent = vi.fn();
    await expect(
      sendClaimThenWait({
        send: async () => ({ txHash: "0xdead" }),
        onTxSent,
        wait: async () => {
          throw new Error("L2 claim tx 0xdead was dropped.");
        },
      }),
    ).rejects.toThrow(/dropped/);
    expect(onTxSent).toHaveBeenCalledWith("0xdead");
  });

  it("still waits when the post-broadcast callback throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wait = vi.fn(async () => "mined");

    await expect(
      sendClaimThenWait({
        send: async () => ({ txHash: "0xsent" }),
        onTxSent: () => {
          throw new Error("storage full");
        },
        wait,
      }),
    ).resolves.toEqual({ l2TxHash: "0xsent", waitResult: "mined" });

    expect(wait).toHaveBeenCalledWith("0xsent");
    warn.mockRestore();
  });
});
