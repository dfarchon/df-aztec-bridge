/**
 * Password-locked vault: setup / unlock / JSON get-set / localStorage migrate.
 * Optional WebAuthn passkey is a second factor (device biometrics / phone).
 */

import {
  computePasswordVerifier,
  decryptJson,
  deriveCek,
  encodeSalt,
  encryptJson,
  decodeSalt,
  profileUsesPasswordVerifier,
  randomBytes,
  verifyPassword,
  verifyPasswordOnly,
  VAULT_KDF_ITERATIONS,
  VAULT_PASSWORD_MIN_LENGTH,
  VAULT_SALT_BYTES,
  type VaultEnvelope,
  type VaultPasskeyMeta,
  type VaultProfileMeta,
} from "./vault-crypto.ts";
import {
  createIdbVaultBackend,
  type VaultBackend,
} from "./vault-idb.ts";
import { assertVaultPasskey } from "./vault-passkey.ts";
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export class VaultLockedError extends VaultError {
  constructor(message = "Vault is locked. Unlock with your password to continue.") {
    super(message);
    this.name = "VaultLockedError";
  }
}

export type VaultWalletsDoc = {
  accounts: unknown[];
  activeAddress: string | null;
};

export type VaultSession = {
  address: string;
  unlocked: boolean;
};

/** Why the vault last locked. Only set by idle / tab-hidden auto-lock. */
export type VaultAutoLockReason = "idle" | "tab-hidden";

type Listener = () => void;

let backend: VaultBackend = createIdbVaultBackend();
let cek: CryptoKey | null = null;
let activeAddress: string | null = null;
let unlocked = false;
let lastLockReason: VaultAutoLockReason | null = null;
const listeners = new Set<Listener>();

export function setVaultBackend(next: VaultBackend): void {
  backend = next;
}

export function resetVaultSession(): void {
  cek = null;
  activeAddress = null;
  unlocked = false;
  lastLockReason = null;
  notify();
}

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeVault(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVaultSession(): VaultSession | null {
  if (!activeAddress) return null;
  return { address: activeAddress, unlocked };
}

export function isVaultUnlocked(): boolean {
  return unlocked && !!cek && !!activeAddress;
}

export function getVaultLockReason(): VaultAutoLockReason | null {
  return lastLockReason;
}

export function getVaultAddress(): string | null {
  return activeAddress;
}

export async function hasVaultProfile(aztecAddress: string): Promise<boolean> {
  const meta = await backend.getMeta(aztecAddress);
  return !!meta;
}

export async function listVaultProfiles(): Promise<VaultProfileMeta[]> {
  const all = await backend.listMeta();
  return all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function hasAnyVaultProfile(): Promise<boolean> {
  const all = await backend.listMeta();
  return all.length > 0;
}

export async function getVaultProfile(
  aztecAddress: string,
): Promise<VaultProfileMeta | null> {
  return backend.getMeta(aztecAddress);
}

/**
 * First-time admin password after successful PXE import.
 * Password-only verifier (v2) so later visits unlock with password + passkey only.
 */
export async function setupVault(opts: {
  aztecAddress: string;
  password: string;
  /** Kept for API compat; not used by the v2 password verifier. */
  signingKey?: string;
  passkey?: VaultPasskeyMeta | null;
}): Promise<void> {
  const address = opts.aztecAddress.trim();
  const password = opts.password;
  if (!address) throw new VaultError("Missing Aztec address for vault setup.");
  if (password.length < VAULT_PASSWORD_MIN_LENGTH) {
    throw new VaultError(`Password must be at least ${VAULT_PASSWORD_MIN_LENGTH} characters.`);
  }

  const existing = await backend.getMeta(address);
  if (existing) {
    throw new VaultError("Vault already exists for this account. Unlock instead.");
  }

  const salt = randomBytes(VAULT_SALT_BYTES);
  const verifier = await computePasswordVerifier(password, salt, address);
  const key = await deriveCek(password, salt);
  const meta: VaultProfileMeta = {
    v: 2,
    aztecAddress: address,
    salt: encodeSalt(salt),
    verifier,
    verifierKind: "password",
    kdf: "PBKDF2-SHA-256",
    iterations: VAULT_KDF_ITERATIONS,
    createdAt: Date.now(),
    ...(opts.passkey ? { passkey: opts.passkey } : {}),
  };
  await backend.putMeta(meta);

  cek = key;
  activeAddress = meta.aztecAddress;
  unlocked = true;
  lastLockReason = null;

  await migrateLocalStorageIntoVault();
  notify();
}

/** Attach or replace a passkey on an existing vault profile (must be unlocked). */
export async function attachVaultPasskey(passkey: VaultPasskeyMeta): Promise<void> {
  const { address } = requireUnlocked();
  const meta = await backend.getMeta(address);
  if (!meta) throw new VaultError("No vault profile to attach passkey.");
  const next: VaultProfileMeta = { ...meta, passkey };
  await backend.putMeta(next);
  notify();
}

/**
 * After password verifies: unlock without the old passkey, then store a new passkey for this host.
 * Use when the device has no matching WebAuthn credential (localhost vs Netlify, cleared OS keys, …).
 */
export async function unlockAndReplacePasskey(opts: {
  aztecAddress: string;
  password: string;
  signingKey?: string;
  passkey: VaultPasskeyMeta;
}): Promise<void> {
  await unlockVault({
    aztecAddress: opts.aztecAddress,
    password: opts.password,
    signingKey: opts.signingKey,
    skipPasskey: true,
  });
  await attachVaultPasskey(opts.passkey);
}

/** Delete vault profile after password check (skip passkey). User can re-import DF Punk JSON + setup. */
export async function wipeVaultProfileWithPassword(opts: {
  aztecAddress: string;
  password: string;
  signingKey?: string;
}): Promise<void> {
  await unlockVault({
    aztecAddress: opts.aztecAddress,
    password: opts.password,
    signingKey: opts.signingKey,
    skipPasskey: true,
  });
  const address = opts.aztecAddress.trim();
  await deleteVaultProfile(address);
}

/** Delete a vault profile and its encrypted docs. Safe to call for a non-active address. */
export async function deleteVaultProfile(aztecAddress: string): Promise<void> {
  const address = aztecAddress.trim();
  if (!address) throw new VaultError("Missing Aztec address.");
  await backend.deleteProfile(address);
  if (activeAddress?.toLowerCase() === address.toLowerCase()) {
    cek = null;
    unlocked = false;
    activeAddress = null;
    lastLockReason = null;
  }
  notify();
}

/** Delete the currently unlocked vault profile without asking for the password again. */
export async function wipeUnlockedVaultProfile(): Promise<void> {
  const { address } = requireUnlocked();
  await deleteVaultProfile(address);
}

export async function unlockVault(opts: {
  aztecAddress: string;
  password: string;
  /** Optional — only needed for legacy v1 signingKey-bound verifiers without a wallets doc. */
  signingKey?: string;
  /** Test-only: skip WebAuthn when a passkey is registered. */
  skipPasskey?: boolean;
}): Promise<void> {
  const address = opts.aztecAddress.trim();
  const signingKey = opts.signingKey?.trim() || "";
  const meta = await backend.getMeta(address);
  if (!meta) {
    throw new VaultError("No vault for this account. Import DF Punk JSON and set a password.");
  }
  const salt = decodeSalt(meta.salt);
  const iterations = meta.iterations ?? VAULT_KDF_ITERATIONS;
  let ok = false;

  if (profileUsesPasswordVerifier(meta)) {
    ok = await verifyPasswordOnly(opts.password, salt, meta.aztecAddress, meta.verifier, iterations);
  } else if (signingKey) {
    ok = await verifyPassword(opts.password, salt, signingKey, meta.verifier, iterations);
  } else {
    const probeKey = await deriveCek(opts.password, salt, iterations);
    const env = await backend.getDoc(meta.aztecAddress, "wallets");
    if (!env) {
      throw new VaultError(
        "This vault needs a one-time DF Punk JSON re-import (legacy password verifier). Then unlock works with password + passkey only.",
      );
    }
    try {
      await decryptJson(probeKey, env);
      ok = true;
      const nextVerifier = await computePasswordVerifier(
        opts.password,
        salt,
        meta.aztecAddress,
        iterations,
      );
      await backend.putMeta({
        ...meta,
        v: 2,
        verifier: nextVerifier,
        verifierKind: "password",
      });
    } catch {
      ok = false;
    }
  }

  if (!ok) {
    throw new VaultError("Invalid password.");
  }

  if (meta.passkey && !opts.skipPasskey) {
    await assertVaultPasskey(meta.passkey);
  }

  cek = await deriveCek(opts.password, salt, iterations);
  activeAddress = meta.aztecAddress;
  unlocked = true;
  lastLockReason = null;
  notify();
}

export function lockVault(reason?: VaultAutoLockReason): void {
  cek = null;
  unlocked = false;
  lastLockReason = reason ?? null;
  // Keep activeAddress so UI knows which profile is selected but locked.
  notify();
}

export function bindVaultAddress(aztecAddress: string | null): void {
  const next = aztecAddress?.trim() || null;
  if (next?.toLowerCase() !== activeAddress?.toLowerCase()) {
    cek = null;
    unlocked = false;
    lastLockReason = null;
  }
  activeAddress = next;
  notify();
}

function requireUnlocked(): { address: string; key: CryptoKey } {
  if (!unlocked || !cek || !activeAddress) throw new VaultLockedError();
  return { address: activeAddress, key: cek };
}

export async function vaultGetJson<T>(docId: string): Promise<T | null> {
  const { address, key } = requireUnlocked();
  const env = await backend.getDoc(address, docId);
  if (!env) return null;
  return decryptJson<T>(key, env);
}

export async function vaultSetJson(docId: string, value: unknown): Promise<void> {
  const { address, key } = requireUnlocked();
  // Ensure JSON-only
  JSON.parse(JSON.stringify(value));
  const env = await encryptJson(key, value);
  await backend.putDoc(address, docId, env);
}

export async function vaultListDocs(): Promise<string[]> {
  const { address } = requireUnlocked();
  return backend.listDocIds(address);
}

const VAULT_BACKUP_FORMAT = "df-bridge-vault-backup-v1";
const VAULT_DOC_ID = /^[a-zA-Z0-9:_-]{1,64}$/;

export type VaultEncryptedBackup = {
  format: typeof VAULT_BACKUP_FORMAT;
  exportedAt: string;
  aztecAddress: string;
  docs: Record<string, VaultEnvelope>;
};

function isVaultEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== "object") return false;
  const env = value as VaultEnvelope;
  return env.v === 1 && typeof env.iv === "string" && !!env.iv && typeof env.ct === "string" && !!env.ct;
}

/** Downloadable backup is the ciphertext already stored in IndexedDB. */
export async function vaultExportAllJson(): Promise<VaultEncryptedBackup> {
  const { address } = requireUnlocked();
  const ids = await backend.listDocIds(address);
  const docs: Record<string, VaultEnvelope> = {};
  for (const id of ids) {
    const env = await backend.getDoc(address, id);
    if (!env || !isVaultEnvelope(env)) continue;
    docs[id] = { v: 1, iv: env.iv, ct: env.ct };
  }
  return {
    format: VAULT_BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    aztecAddress: address,
    docs,
  };
}

/** Restore a ciphertext backup into the unlocked profile. Same password must still unlock it. */
export async function vaultImportEncryptedBackup(raw: unknown): Promise<number> {
  const { address } = requireUnlocked();
  if (!raw || typeof raw !== "object") {
    throw new VaultError("Backup file is not a vault backup.");
  }
  const file = raw as Partial<VaultEncryptedBackup>;
  if (file.format !== VAULT_BACKUP_FORMAT) {
    throw new VaultError("Backup file is not an encrypted vault backup.");
  }
  if (typeof file.aztecAddress !== "string" || file.aztecAddress.trim().toLowerCase() !== address.toLowerCase()) {
    throw new VaultError("Backup address does not match the unlocked vault.");
  }
  if (!file.docs || typeof file.docs !== "object" || Array.isArray(file.docs)) {
    throw new VaultError("Backup file has no documents.");
  }
  const entries = Object.entries(file.docs);
  for (const [id, env] of entries) {
    if (!VAULT_DOC_ID.test(id) || !isVaultEnvelope(env)) {
      throw new VaultError("Backup file contains an invalid document.");
    }
  }
  for (const [id, env] of entries) {
    await backend.putDoc(address, id, { v: 1, iv: env.iv, ct: env.ct });
  }
  return entries.length;
}

const LS_WALLETS = "df-bridge:aztec-wallets:v1";
const LS_ACTIVE = "df-bridge:aztec-wallets:active";
const LS_RPC = "df-bridge:rpc-overrides";
const LS_BRIDGE_V2 = "df_aztec_bridge_sessions";
const LS_BRIDGE_V1 = "df_aztec_bridge_session";

/**
 * One-shot migrate plaintext localStorage → encrypted vault docs, then wipe LS keys.
 * Call only while unlocked.
 */
export async function migrateLocalStorageIntoVault(): Promise<void> {
  if (!isVaultUnlocked()) throw new VaultLockedError();
  if (typeof localStorage === "undefined") return;

  try {
    const walletsRaw = localStorage.getItem(LS_WALLETS);
    const active = localStorage.getItem(LS_ACTIVE);
    if (walletsRaw) {
      const accounts = JSON.parse(walletsRaw) as unknown;
      if (Array.isArray(accounts)) {
        await vaultSetJson("wallets", {
          accounts,
          activeAddress: active,
        } satisfies VaultWalletsDoc);
      }
    }

    const rpcRaw = localStorage.getItem(LS_RPC);
    if (rpcRaw) {
      const rpc = JSON.parse(rpcRaw) as unknown;
      if (rpc && typeof rpc === "object" && !Array.isArray(rpc)) {
        await vaultSetJson("rpc", rpc);
      }
    }

    // Per-network bridge stores
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(`${LS_BRIDGE_V2}:`)) {
        const networkId = key.slice(`${LS_BRIDGE_V2}:`.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const store = JSON.parse(raw) as unknown;
          await vaultSetJson(`bridge:${networkId}`, store);
        } catch {
          /* skip corrupt */
        }
      }
    }

    const legacyV2 = localStorage.getItem(LS_BRIDGE_V2);
    if (legacyV2) {
      try {
        const store = JSON.parse(legacyV2) as { networkId?: string };
        if (store?.networkId) {
          await vaultSetJson(`bridge:${store.networkId}`, store);
        }
      } catch {
        /* skip */
      }
    }
    const legacyV1 = localStorage.getItem(LS_BRIDGE_V1);
    if (legacyV1) {
      try {
        const store = JSON.parse(legacyV1) as { networkId?: string };
        if (store?.networkId) {
          await vaultSetJson(`bridge:${store.networkId}:legacy-v1`, store);
        }
      } catch {
        /* skip */
      }
    }
  } finally {
    wipeMigratedLocalStorage();
  }
}

export function wipeMigratedLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  for (const key of keys) {
    if (
      key === LS_WALLETS ||
      key === LS_ACTIVE ||
      key === LS_RPC ||
      key === LS_BRIDGE_V1 ||
      key === LS_BRIDGE_V2 ||
      key.startsWith(`${LS_BRIDGE_V2}:`) ||
      key.startsWith(`${LS_BRIDGE_V2}__`)
    ) {
      localStorage.removeItem(key);
    }
  }
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
