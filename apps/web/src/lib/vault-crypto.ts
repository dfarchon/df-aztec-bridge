/**
 * Password vault crypto — Web Crypto only (no npm deps).
 * CEK = PBKDF2(password, salt); verifier = HMAC-SHA256(CEK, signingKey).
 */

export const VAULT_KDF_ITERATIONS = 210_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;

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
};

export type VaultProfileMeta = {
  v: 1;
  aztecAddress: string;
  salt: string;
  verifier: string;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  createdAt: number;
  /** Optional WebAuthn second factor (device / phone passkey). */
  passkey?: VaultPasskeyMeta;
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

export async function verifyPassword(
  password: string,
  salt: Uint8Array,
  signingKey: string,
  expectedVerifierB64: string,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<boolean> {
  const got = await computeVerifier(password, salt, signingKey, iterations);
  if (got.length !== expectedVerifierB64.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ expectedVerifierB64.charCodeAt(i);
  }
  return diff === 0;
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
