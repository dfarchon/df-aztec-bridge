/**
 * Password vault crypto — Web Crypto only (no npm deps).
 * Password-only vaults: CEK = PBKDF2(password, salt).
 * Passkey vaults: random CEK wrapped by HKDF(PBKDF2(password) || WebAuthn PRF).
 * Verifier (v2): HMAC(password-derived key, purpose|aztecAddress).
 * Legacy v1: HMAC(password-derived key, signingKey).
 */

/** New vaults and the next unlock of an older vault. OWASP PBKDF2-HMAC-SHA256 floor is 600,000. */
export const VAULT_KDF_ITERATIONS = 600_000;
/** New vaults only. Existing shorter passwords still unlock. */
export const VAULT_PASSWORD_MIN_LENGTH = 12;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;
export const VAULT_PASSWORD_VERIFIER_PURPOSE = "df-bridge-vault-v2";

export type VaultEnvelope = {
  v: 1;
  iv: string;
  ct: string;
};

export type VaultPasskeyMeta = {
  credentialId: string;
  rpId: string;
  createdAt: number;
  transports?: string[];
  /** Salt passed to the WebAuthn PRF eval. Present once the passkey wraps the CEK. */
  prfSalt?: string;
};

export type VaultCekWrap = {
  v: 1;
  iv: string;
  ct: string;
  kdf: "pbkdf2-prf-hkdf";
};

export type VaultVerifierKind = "password" | "signingKey";

export type VaultProfileMeta = {
  /** 2 = password-only verifier. 1 = legacy signingKey-bound. */
  v: 1 | 2;
  aztecAddress: string;
  salt: string;
  verifier: string;
  verifierKind?: VaultVerifierKind;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  createdAt: number;
  passkey?: VaultPasskeyMeta;
  /** Set when the CEK is random and wrapped. Password alone cannot decrypt. */
  cekWrap?: VaultCekWrap;
};

function b64Encode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

function b64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export async function deriveCek(
  password: string,
  salt: Uint8Array,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    textBytes(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** HMAC key for verifier — derived from same password material (separate PBKDF2 → HMAC key). */
export async function deriveHmacKey(
  password: string,
  salt: Uint8Array,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    textBytes(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

export async function computeVerifier(
  password: string,
  salt: Uint8Array,
  signingKey: string,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<string> {
  const hmacKey = await deriveHmacKey(password, salt, iterations);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, textBytes(signingKey.trim()));
  return b64Encode(sig);
}

function timingSafeEqualB64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPassword(
  password: string,
  salt: Uint8Array,
  signingKey: string,
  expectedVerifierB64: string,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<boolean> {
  const got = await computeVerifier(password, salt, signingKey, iterations);
  return timingSafeEqualB64(got, expectedVerifierB64);
}

export async function computePasswordVerifier(
  password: string,
  salt: Uint8Array,
  aztecAddress: string,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<string> {
  const hmacKey = await deriveHmacKey(password, salt, iterations);
  const material = `${VAULT_PASSWORD_VERIFIER_PURPOSE}|${aztecAddress.trim().toLowerCase()}`;
  const sig = await crypto.subtle.sign("HMAC", hmacKey, textBytes(material));
  return b64Encode(sig);
}

export async function verifyPasswordOnly(
  password: string,
  salt: Uint8Array,
  aztecAddress: string,
  expectedVerifierB64: string,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<boolean> {
  const got = await computePasswordVerifier(password, salt, aztecAddress, iterations);
  return timingSafeEqualB64(got, expectedVerifierB64);
}

export function profileUsesPasswordVerifier(meta: VaultProfileMeta): boolean {
  if (meta.verifierKind === "password" || meta.v === 2) return true;
  if (meta.verifierKind === "signingKey") return false;
  return false;
}

export async function encryptJson(
  cek: CryptoKey,
  value: unknown,
): Promise<VaultEnvelope> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Vault only stores JSON-serializable values.");
  const iv = randomBytes(VAULT_IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cek,
    textBytes(json),
  );
  return { v: 1, iv: b64Encode(iv), ct: b64Encode(ct) };
}

export async function decryptJson<T = unknown>(
  cek: CryptoKey,
  envelope: VaultEnvelope,
): Promise<T> {
  if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.ct) {
    throw new Error("Invalid vault envelope.");
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64Decode(envelope.iv) },
    cek,
    b64Decode(envelope.ct),
  );
  const text = new TextDecoder().decode(plain);
  return JSON.parse(text) as T;
}

export function decodeSalt(b64: string): Uint8Array {
  return b64Decode(b64);
}

export function encodeSalt(salt: Uint8Array): string {
  return b64Encode(salt);
}

const WRAP_INFO = "df-bridge-vault-cek-wrap-v1";

export async function derivePasswordBits(
  password: string,
  salt: Uint8Array,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", textBytes(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveWrapKey(
  passwordBits: Uint8Array,
  prfSecret: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const ikm = new Uint8Array(passwordBits.length + prfSecret.length);
  ikm.set(passwordBits, 0);
  ikm.set(prfSecret, passwordBits.length);
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  ikm.fill(0);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: textBytes(WRAP_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function randomCekBytes(): Uint8Array {
  return randomBytes(32);
}

export async function importCek(raw: Uint8Array, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"]);
}

export async function wrapCek(
  wrapKey: CryptoKey,
  cek: CryptoKey,
): Promise<VaultCekWrap> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", cek));
  const iv = randomBytes(VAULT_IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, raw);
  raw.fill(0);
  return { v: 1, iv: b64Encode(iv), ct: b64Encode(ct), kdf: "pbkdf2-prf-hkdf" };
}

export async function unwrapCek(wrapKey: CryptoKey, wrap: VaultCekWrap): Promise<CryptoKey> {
  if (!wrap || wrap.v !== 1 || wrap.kdf !== "pbkdf2-prf-hkdf" || !wrap.iv || !wrap.ct) {
    throw new Error("Invalid vault key wrap.");
  }
  const raw = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64Decode(wrap.iv) }, wrapKey, b64Decode(wrap.ct)),
  );
  const key = await importCek(raw, false);
  raw.fill(0);
  return key;
}
