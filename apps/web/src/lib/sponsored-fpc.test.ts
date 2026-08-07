import { describe, expect, it } from "vitest";
import {
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
});
