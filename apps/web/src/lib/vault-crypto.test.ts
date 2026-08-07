import { describe, expect, it } from "vitest";
import {
  computeVerifier,
  decryptJson,
  deriveCek,
  encodeSalt,
  encryptJson,
  randomBytes,
  verifyPassword,
  VAULT_SALT_BYTES,
} from "./vault-crypto.ts";

describe("vault-crypto", () => {
  it("derives verifier from password + signingKey and rejects wrong password", async () => {
    const salt = randomBytes(VAULT_SALT_BYTES);
    const password = "correct-horse-battery";
    const signingKey = "0xabc123signingkey";
    const verifier = await computeVerifier(password, salt, signingKey);
    expect(await verifyPassword(password, salt, signingKey, verifier)).toBe(true);
    expect(await verifyPassword("wrong-password-xx", salt, signingKey, verifier)).toBe(false);
    expect(await verifyPassword(password, salt, "0xother", verifier)).toBe(false);
  });

  it("round-trips JSON through AES-GCM", async () => {
    const salt = randomBytes(VAULT_SALT_BYTES);
    const cek = await deriveCek("test-password-12", salt);
    const payload = { hello: "world", n: 42, nested: { a: true } };
    const env = await encryptJson(cek, payload);
    expect(env.v).toBe(1);
    expect(env.iv).toBeTruthy();
    expect(env.ct).toBeTruthy();
    const back = await decryptJson<typeof payload>(cek, env);
    expect(back).toEqual(payload);
    expect(encodeSalt(salt).length).toBeGreaterThan(10);
  });
});
