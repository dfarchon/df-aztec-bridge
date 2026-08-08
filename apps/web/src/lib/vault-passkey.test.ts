import { beforeEach, describe, expect, it } from "vitest";
import {
  describePasskeyHostMismatch,
  isWebAuthnAvailable,
} from "./vault-passkey.ts";
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
  unlockAndReplacePasskey,
  unlockVault,
  vaultGetJson,
  vaultSetJson,
  wipeVaultProfileWithPassword,
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

  it("unlockAndReplacePasskey swaps passkey after password", async () => {
    await setupVault({
      aztecAddress: ADDR,
      password: PASS,
      signingKey: SIGNING,
      passkey: {
        credentialId: btoa("old-cred"),
        rpId: "aztec-dfarchon-kit.netlify.app",
        createdAt: 1,
      },
    });
    lockVault();
    await unlockAndReplacePasskey({
      aztecAddress: ADDR,
      password: PASS,
      signingKey: SIGNING,
      passkey: {
        credentialId: btoa("new-cred"),
        rpId: "localhost",
        createdAt: 2,
      },
    });
    expect(isVaultUnlocked()).toBe(true);
    const meta = await getVaultProfile(ADDR);
    expect(meta?.passkey?.credentialId).toBe(btoa("new-cred"));
    expect(meta?.passkey?.rpId).toBe("localhost");
  });

  it("wipeVaultProfileWithPassword removes profile after password", async () => {
    await setupVault({
      aztecAddress: ADDR,
      password: PASS,
      signingKey: SIGNING,
      passkey: { credentialId: btoa("x"), rpId: "localhost", createdAt: 1 },
    });
    lockVault();
    await wipeVaultProfileWithPassword({
      aztecAddress: ADDR,
      password: PASS,
      signingKey: SIGNING,
    });
    expect(await hasVaultProfile(ADDR)).toBe(false);
    expect(isVaultUnlocked()).toBe(false);
  });
});

describe("passkey host mismatch copy", () => {
  it("exports describePasskeyHostMismatch", () => {
    expect(typeof describePasskeyHostMismatch).toBe("function");
    // Without a browser hostname, mismatch vs stored host is null or a string.
    const msg = describePasskeyHostMismatch({
      credentialId: "x",
      rpId: "aztec-dfarchon-kit.netlify.app",
      createdAt: 1,
    });
    expect(msg === null || /registered for/i.test(msg)).toBe(true);
  });
});

describe("vault-passkey availability", () => {
  it("reports a boolean in this environment", () => {
    expect(typeof isWebAuthnAvailable()).toBe("boolean");
  });
});
