import { describe, expect, it, vi } from "vitest";
import type { ClaimCredentials } from "@df-bridge/browser-sdk";
import { checkImportedClaimStatus, describeClaimImport } from "./claim-import-status.ts";

const claim = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@df-bridge/browser-sdk/claim-lazy", () => ({
  loadBrowserClaim: async () => ({ getClaimMessageStatus: claim.check }),
}));

const hash = "0x1234567890123456789012345678901234567890123456789012345678901234";

describe("claim import status", () => {
  it("rechecks the saved credentials and preserves the node result", async () => {
    const credentials = { recipient: "0x123" } as ClaimCredentials;
    claim.check.mockResolvedValueOnce("consumed");
    await expect(checkImportedClaimStatus("https://node.example", credentials)).resolves.toBe("consumed");
    expect(claim.check).toHaveBeenLastCalledWith({ aztecNodeUrl: "https://node.example", credentials });
  });

  it("reports an unavailable status when the node fails or is missing", async () => {
    const credentials = {} as ClaimCredentials;
    claim.check.mockRejectedValueOnce(new Error("node unavailable"));
    await expect(checkImportedClaimStatus("https://node.example", credentials)).resolves.toBe("unavailable");
    await expect(checkImportedClaimStatus(undefined, credentials)).resolves.toBe("unavailable");
  });
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
