import { describe, expect, it } from "vitest";
import {
  assertAztecReplaceBackupReady,
  needsAztecAccountReplace,
} from "./aztec-wallet-store.ts";

describe("single Aztec account policy", () => {
  const current = "0x" + "11".repeat(32);
  const other = "0x" + "22".repeat(32);

  it("allows the first import and same-address updates", () => {
    expect(needsAztecAccountReplace(null, current)).toBe(false);
    expect(needsAztecAccountReplace(current, current)).toBe(false);
    expect(() =>
      assertAztecReplaceBackupReady({
        existingAddress: current,
        incomingAddress: current,
        backupReady: false,
      }),
    ).not.toThrow();
  });

  it("blocks a second address until a JSON backup is ready", () => {
    expect(needsAztecAccountReplace(current, other)).toBe(true);
    expect(() =>
      assertAztecReplaceBackupReady({
        existingAddress: current,
        incomingAddress: other,
        backupReady: false,
      }),
    ).toThrow(/one Aztec account/i);
    expect(() =>
      assertAztecReplaceBackupReady({
        existingAddress: current,
        incomingAddress: other,
        backupReady: true,
      }),
    ).not.toThrow();
  });
});
