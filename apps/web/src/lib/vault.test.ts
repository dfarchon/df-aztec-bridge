import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import {
  computePasswordVerifier,
  decodeSalt,
  decryptJson,
  deriveCek,
  encodeSalt,
  encryptJson,
  randomBytes,
  VAULT_KDF_ITERATIONS,
  VAULT_SALT_BYTES,
} from "./vault-crypto.ts";
import {
  deleteVaultProfile,
  getVaultLockReason,
  getVaultProfile,
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
  wipeVaultProfileWithPassword,
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
    expect((await listVaultProfiles())[0]?.iterations).toBe(VAULT_KDF_ITERATIONS);
    expect(VAULT_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);

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

  it("rekeys a 210k vault to 600k and keeps the document", async () => {
    const memory = createMemoryVaultBackend();
    setVaultBackend(memory);
    const salt = randomBytes(VAULT_SALT_BYTES);
    const iterations = 210_000;
    const key = await deriveCek(PASS, salt, iterations);
    await memory.putMeta({
      v: 2,
      aztecAddress: ADDR,
      salt: encodeSalt(salt),
      verifier: await computePasswordVerifier(PASS, salt, ADDR, iterations),
      verifierKind: "password",
      kdf: "PBKDF2-SHA-256",
      iterations,
      createdAt: 1,
    });
    await memory.putDoc(ADDR, "wallets", await encryptJson(key, { secret: "kept" }));
    await unlockVault({ aztecAddress: ADDR, password: PASS });
    expect((await getVaultProfile(ADDR))?.iterations).toBe(VAULT_KDF_ITERATIONS);
    expect(await vaultGetJson("wallets")).toEqual({ secret: "kept" });
  });

  it("wraps the vault key when a PRF secret is supplied", async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    await setupVault({
      aztecAddress: ADDR,
      password: PASS,
      prfSecret: prf,
      passkey: {
        credentialId: btoa("wrapped"),
        rpId: "localhost",
        createdAt: 1,
        prfSalt: btoa("salt"),
      },
    });
    await vaultSetJson("wallets", { secret: "wrapped" });
    const meta = await getVaultProfile(ADDR);
    expect(meta?.cekWrap?.kdf).toBe("pbkdf2-prf-hkdf");
    const exported = await vaultExportAllJson();
    const passwordOnly = await deriveCek(PASS, decodeSalt(meta!.salt), meta!.iterations);
    await expect(decryptJson(passwordOnly, exported.docs.wallets!)).rejects.toThrow();
    lockVault();
    await expect(
      unlockVault({ aztecAddress: ADDR, password: PASS, skipPasskey: true }),
    ).rejects.toThrow(/passkey/i);
    await expect(
      unlockVault({
        aztecAddress: ADDR,
        password: PASS,
        skipPasskey: true,
        prfSecret: crypto.getRandomValues(new Uint8Array(32)),
      }),
    ).rejects.toThrow(/wrap/i);
    await unlockVault({
      aztecAddress: ADDR,
      password: PASS,
      skipPasskey: true,
      prfSecret: prf,
    });
    expect(await vaultGetJson("wallets")).toEqual({ secret: "wrapped" });
    lockVault();
    await wipeVaultProfileWithPassword({ aztecAddress: ADDR, password: PASS });
    expect(await hasVaultProfile(ADDR)).toBe(false);
  });
});
