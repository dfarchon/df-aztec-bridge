import { beforeEach, describe, expect, it } from "vitest";
import { isWebAuthnAvailable } from "./vault-passkey.ts";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import {
  attachVaultPasskey,
  getVaultProfile,
  hasVaultProfile,
  isVaultUnlocked,
  lockVault,
  resetVaultSession,
  setVaultBackend,
  setupVault,
  unlockVault,
  vaultGetJson,
  vaultSetJson,
} from "./vault.ts";

const ADDR = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SIGNING = "0xdeadbeefsigningkey";
const PASS = "vault-password-ok";

describe("vault passkey meta", () => {
  beforeEach(() => {
    setVaultBackend(createMemoryVaultBackend());
    resetVaultSession();
  });

  it("stores passkey on setup", async () => {
    const passkey = {
      credentialId: btoa("cred-raw-id"),
      rpId: "localhost",
      createdAt: Date.now(),
      transports: ["internal"],
    };

    await setupVault({
      aztecAddress: ADDR,
      password: PASS,
      signingKey: SIGNING,
      passkey,
    });
    expect(await hasVaultProfile(ADDR)).toBe(true);
    const meta = await getVaultProfile(ADDR);
    expect(meta?.passkey?.credentialId).toBe(passkey.credentialId);

    lockVault();
    await unlockVault({
      aztecAddress: ADDR,
      password: PASS,
      signingKey: SIGNING,
      skipPasskey: true,
    });
    expect(isVaultUnlocked()).toBe(true);
  });

  it("attachVaultPasskey updates meta while unlocked", async () => {
    await setupVault({ aztecAddress: ADDR, password: PASS, signingKey: SIGNING });
    await attachVaultPasskey({
      credentialId: btoa("later-cred"),
      rpId: "localhost",
      createdAt: Date.now(),
    });
    const meta = await getVaultProfile(ADDR);
    expect(meta?.passkey?.credentialId).toBe(btoa("later-cred"));
    await vaultSetJson("rpc", { x: 1 });
    expect(await vaultGetJson("rpc")).toEqual({ x: 1 });
  });
});

describe("vault-passkey availability", () => {
  it("reports a boolean in this environment", () => {
    expect(typeof isWebAuthnAvailable()).toBe("boolean");
  });
});
