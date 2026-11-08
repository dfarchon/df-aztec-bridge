import { describe, expect, it } from "vitest";
import { describeClaimImport } from "./claim-import-status.ts";

const hash = "0x1234567890123456789012345678901234567890123456789012345678901234";

describe("claim import status", () => {
  it("never saves a consumed claim, and preserves existing records", () => {
    const fresh = describeClaimImport("consumed", false, hash);
    expect(fresh.shouldSave).toBe(false);
    expect(fresh.message).toMatch(/already consumed.*no new claim/i);
    const existing = describeClaimImport("consumed", true, hash);
    expect(existing.shouldSave).toBe(false);
    expect(existing.message).toContain("existing local record was kept");
  });

  it("does not claim a pending or unavailable node result proves success", () => {
    for (const status of ["l2-sync-pending", "unavailable"] as const) {
      expect(describeClaimImport(status, false, hash).shouldSave).toBe(true);
      expect(describeClaimImport(status, true, hash).shouldSave).toBe(false);
      expect(describeClaimImport(status, false, hash).message).toMatch(/cannot be confirmed|could not check/i);
    }
  });

  it("allows an available message to be saved only once", () => {
    expect(describeClaimImport("ready", false, hash).shouldSave).toBe(true);
    expect(describeClaimImport("ready", true, hash).shouldSave).toBe(false);
    expect(describeClaimImport("ready", false, hash).message).toContain("available to claim");
  });
});
