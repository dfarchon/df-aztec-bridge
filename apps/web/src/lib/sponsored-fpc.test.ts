import { describe, expect, it } from "vitest";
import {
  assertPinnedSponsoredFpc,
  CANONICAL_SPONSORED_FPC_ADDRESS,
  getSponsoredFpcAddress,
  isSponsoredFpcAddress,
} from "./sponsored-fpc.ts";

describe("sponsored-fpc", () => {
  it("exposes the DF / protocol canonical Sponsored FPC", () => {
    expect(CANONICAL_SPONSORED_FPC_ADDRESS).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(getSponsoredFpcAddress()).toBe(CANONICAL_SPONSORED_FPC_ADDRESS);
    expect(isSponsoredFpcAddress(CANONICAL_SPONSORED_FPC_ADDRESS)).toBe(true);
    expect(isSponsoredFpcAddress("0x00")).toBe(false);
  });

  it("pins empty or matching env to the canonical address", () => {
    expect(assertPinnedSponsoredFpc(undefined)).toBe(CANONICAL_SPONSORED_FPC_ADDRESS);
    expect(assertPinnedSponsoredFpc("")).toBe(CANONICAL_SPONSORED_FPC_ADDRESS);
    expect(assertPinnedSponsoredFpc(`  ${CANONICAL_SPONSORED_FPC_ADDRESS}  `)).toBe(
      CANONICAL_SPONSORED_FPC_ADDRESS,
    );
  });

  it("rejects a mismatched Sponsored FPC override", () => {
    const other =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    expect(() => assertPinnedSponsoredFpc(other)).toThrow(/does not match the pinned Sponsored FPC/);
    expect(() => assertPinnedSponsoredFpc("0xabc")).toThrow(/32-byte Aztec address/);
  });
});
