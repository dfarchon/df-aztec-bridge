import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import {
  hasVaultProfile,
  isVaultUnlocked,
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

  it("setup + unlock with password and signingKey verifier", async () => {
    expect(await hasVaultProfile(ADDR)).toBe(false);
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    expect(isVaultUnlocked()).toBe(true);
    expect(await hasVaultProfile(ADDR)).toBe(true);

    await vaultSetJson("wallets", { accounts: [{ address: ADDR }], activeAddress: ADDR });
    const doc = await vaultGetJson<{ accounts: { address: string }[] }>("wallets");
    expect(doc?.accounts[0]?.address).toBe(ADDR);

    lockVault();
    expect(isVaultUnlocked()).toBe(false);

    await unlockVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    expect(isVaultUnlocked()).toBe(true);
    const again = await vaultGetJson<{ accounts: { address: string }[] }>("wallets");
    expect(again?.accounts[0]?.address).toBe(ADDR);

    const exported = await vaultExportAllJson();
    expect(exported.aztecAddress).toBe(ADDR);
    expect((exported.docs as Record<string, unknown>).wallets).toBeTruthy();
  });

  it("rejects wrong password on unlock", async () => {
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    lockVault();
    await expect(
      unlockVault({ aztecAddress: ADDR, password: "nope-nope-nope", signingKey: SIGNING }),
    ).rejects.toThrow(/Invalid password/);
  });
});
