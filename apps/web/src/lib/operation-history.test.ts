import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import {
  isVaultUnlocked,
  resetVaultSession,
  setVaultBackend,
  setupVault,
  lockVault,
} from "./vault.ts";
import {
  HISTORY_MAX_ENTRIES,
  appendHistory,
  groupHistoryByDay,
  historyTitle,
  listHistory,
  recordHistory,
} from "./operation-history.ts";

const ADDR = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SIGNING = "0xdeadbeefsigningkey";
const PASS = "vault-password-ok";

describe("operation history", () => {
  beforeEach(async () => {
    setVaultBackend(createMemoryVaultBackend());
    resetVaultSession();
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
  });

  it("writes a claim without storing secrets", async () => {
    const saved = await appendHistory({
      networkId: "testnet",
      kind: "claim-confirmed",
      amount: "5700000000000000000",
      recipient: ADDR,
      l1TxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      l2TxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      detail: "Fee Juice claimed on Aztec.",
    });
    expect(saved?.title).toBe("5.7 FJ claimed");
    const listed = await listHistory();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed[0])).not.toMatch(/secret|password|signingKey/i);
  });

  it("does not write while the vault is locked", async () => {
    lockVault();
    expect(isVaultUnlocked()).toBe(false);
    expect(
      await appendHistory({
        networkId: "testnet",
        kind: "account-imported",
        recipient: ADDR,
      }),
    ).toBeNull();
    expect(await listHistory()).toEqual([]);
    await recordHistory({
      networkId: "testnet",
      kind: "account-imported",
      recipient: ADDR,
    });
    expect(await listHistory()).toEqual([]);
  });

  it("keeps the newest 200 entries", async () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i += 1) {
      await appendHistory({
        networkId: "testnet",
        kind: "account-imported",
        recipient: ADDR,
        at: 1_000 + i,
        title: `entry ${i}`,
      });
    }
    const listed = await listHistory();
    expect(listed).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(listed[0]?.title).toBe(`entry ${HISTORY_MAX_ENTRIES + 4}`);
  });

  it("groups newest days first", () => {
    const groups = groupHistoryByDay([
      {
        id: "2",
        at: Date.UTC(2026, 9, 14, 12),
        networkId: "testnet",
        kind: "claim-confirmed",
        title: "later",
      },
      {
        id: "1",
        at: Date.UTC(2026, 9, 13, 12),
        networkId: "testnet",
        kind: "l1-confirmed",
        title: "earlier",
      },
    ]);
    expect(groups[0]?.items[0]?.title).toBe("later");
    expect(groups).toHaveLength(2);
  });

  it("names account events without an amount", () => {
    expect(historyTitle("account-replaced")).toBe("Account replaced");
  });
});
