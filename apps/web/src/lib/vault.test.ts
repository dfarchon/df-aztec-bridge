import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import {
  deleteVaultProfile,
  getVaultLockReason,
  hasAnyVaultProfile,
  hasVaultProfile,
  isVaultUnlocked,
  listVaultProfiles,
  lockVault,
  resetVaultSession,
  setVaultBackend,
  setupVault,
  unlockVault,
  vaultExportAllJson,
  vaultImportEncryptedBackup,
  vaultGetJson,
  vaultSetJson,
  wipeUnlockedVaultProfile,
} from "./vault.ts";

const ADDR = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SIGNING = "0xdeadbeefsigningkey";
const PASS = "vault-password-ok";

describe("vault", () => {
  beforeEach(() => {
    setVaultBackend(createMemoryVaultBackend());
    resetVaultSession();
  });

  it("setup + unlock with password only (no signingKey in memory)", async () => {
    expect(await hasVaultProfile(ADDR)).toBe(false);
    expect(await hasAnyVaultProfile()).toBe(false);
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    expect(isVaultUnlocked()).toBe(true);
    expect(await hasAnyVaultProfile()).toBe(true);
    expect((await listVaultProfiles())[0]?.verifierKind).toBe("password");

    await vaultSetJson("wallets", {
      accounts: [{ address: ADDR, secretKey: "0x1", salt: "0x0", signingKey: SIGNING }],
      activeAddress: ADDR,
    });

    lockVault();
    await unlockVault({ aztecAddress: ADDR, password: PASS });
    expect(isVaultUnlocked()).toBe(true);
    const again = await vaultGetJson<{ accounts: { signingKey?: string }[] }>("wallets");
    expect(again?.accounts[0]?.signingKey).toBe(SIGNING);

    const exported = await vaultExportAllJson();
    expect(exported.format).toBe("df-bridge-vault-backup-v1");
    expect(exported.aztecAddress).toBe(ADDR);
    expect(JSON.stringify(exported)).not.toContain(SIGNING);
    expect(exported.docs.wallets?.v).toBe(1);
    expect(exported.docs.wallets?.ct.length).toBeGreaterThan(0);

    lockVault();
    await unlockVault({ aztecAddress: ADDR, password: PASS });
    await vaultSetJson("wallets", { accounts: [], activeAddress: ADDR });
    await vaultImportEncryptedBackup(exported);
    const restored = await vaultGetJson<{ accounts: { signingKey?: string }[] }>("wallets");
    expect(restored?.accounts[0]?.signingKey).toBe(SIGNING);
  });

  it("rejects a new vault password shorter than 12 characters", async () => {
    await expect(setupVault({ aztecAddress: ADDR, password: "short-pass" })).rejects.toThrow(
      /at least 12/,
    );
  });

  it("deletes an unlocked profile so no vault remains", async () => {
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    await vaultSetJson("wallets", {
      accounts: [{ address: ADDR, secretKey: "0x1", salt: "0x0", signingKey: SIGNING }],
      activeAddress: ADDR,
    });
    await wipeUnlockedVaultProfile();
    expect(isVaultUnlocked()).toBe(false);
    expect(await hasVaultProfile(ADDR)).toBe(false);
    expect(await hasAnyVaultProfile()).toBe(false);
  });

  it("can delete a previous profile after another address is active", async () => {
    const other = "0x2222222222222222222222222222222222222222222222222222222222222222";
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    lockVault();
    await setupVault({ aztecAddress: other, password: PASS, signingKey: SIGNING });
    expect(await hasAnyVaultProfile()).toBe(true);
    await deleteVaultProfile(ADDR);
    expect(await hasVaultProfile(ADDR)).toBe(false);
    expect(await hasVaultProfile(other)).toBe(true);
    expect(isVaultUnlocked()).toBe(true);
  });

  it("records idle lock reason and clears it on unlock", async () => {
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    lockVault("idle");
    expect(isVaultUnlocked()).toBe(false);
    expect(getVaultLockReason()).toBe("idle");
    lockVault();
    expect(getVaultLockReason()).toBeNull();
    await unlockVault({ aztecAddress: ADDR, password: PASS });
    expect(getVaultLockReason()).toBeNull();
  });

  it("rejects wrong password on unlock", async () => {
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    lockVault();
    await expect(
      unlockVault({ aztecAddress: ADDR, password: "nope-nope-nope" }),
    ).rejects.toThrow(/Invalid password/);
  });
});
