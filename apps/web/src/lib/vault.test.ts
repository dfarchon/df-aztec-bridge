import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import {
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
  vaultGetJson,
  vaultSetJson,
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
    expect(exported.aztecAddress).toBe(ADDR);
  });

  it("rejects wrong password on unlock", async () => {
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    lockVault();
    await expect(
      unlockVault({ aztecAddress: ADDR, password: "nope-nope-nope" }),
    ).rejects.toThrow(/Invalid password/);
  });
});
