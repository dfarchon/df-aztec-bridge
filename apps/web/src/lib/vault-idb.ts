/**
 * Native IndexedDB helpers for the password vault (no npm deps).
 *
 * Profile meta (address / salt / verifier) is encrypted at rest with a
 * non-extractable per-origin AES-GCM device key so Application-panel dumps
 * are not plaintext. Unlock still needs the user password (and passkey).
 */

import type { VaultEnvelope, VaultProfileMeta } from "./vault-crypto.ts";

export const VAULT_DB_NAME = "df-bridge-vault";
export const VAULT_DB_VERSION = 2;
export const META_STORE = "meta";
export const DOCS_STORE = "docs";
export const DEVICE_STORE = "device";

const DEVICE_KEY_ID = "meta-wrap-key";

export type VaultBackend = {
  getMeta(address: string): Promise<VaultProfileMeta | null>;
  putMeta(meta: VaultProfileMeta): Promise<void>;
  listMeta(): Promise<VaultProfileMeta[]>;
  getDoc(address: string, docId: string): Promise<VaultEnvelope | null>;
  putDoc(address: string, docId: string, envelope: VaultEnvelope): Promise<void>;
  deleteDoc(address: string, docId: string): Promise<void>;
  listDocIds(address: string): Promise<string[]>;
  deleteProfile(address: string): Promise<void>;
};

type EncMetaBlob = {
  v: "enc1";
  iv: string;
  ct: string;
};

function metaKey(address: string): string {
  return `profile:${address.trim().toLowerCase()}`;
}

function docKey(address: string, docId: string): string {
  return `${address.trim().toLowerCase()}:${docId}`;
}

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(DOCS_STORE)) {
        db.createObjectStore(DOCS_STORE);
      }
      if (!db.objectStoreNames.contains(DEVICE_STORE)) {
        db.createObjectStore(DEVICE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const tx = db.transaction(DEVICE_STORE, "readwrite");
  const store = tx.objectStore(DEVICE_STORE);
  const existing = await idbReq(store.get(DEVICE_KEY_ID));
  if (existing instanceof CryptoKey) {
    await txDone(tx);
    return existing;
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  store.put(key, DEVICE_KEY_ID);
  await txDone(tx);
  return key;
}

function looksLikePlainMeta(raw: unknown): raw is VaultProfileMeta {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as VaultProfileMeta).aztecAddress === "string" &&
    typeof (raw as VaultProfileMeta).verifier === "string" &&
    typeof (raw as VaultProfileMeta).salt === "string"
  );
}

function looksLikeEncBlob(raw: unknown): raw is EncMetaBlob {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as EncMetaBlob).v === "enc1" &&
    typeof (raw as EncMetaBlob).iv === "string" &&
    typeof (raw as EncMetaBlob).ct === "string"
  );
}

async function encryptMeta(key: CryptoKey, meta: VaultProfileMeta): Promise<EncMetaBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(meta));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return { v: "enc1", iv: b64Encode(iv), ct: b64Encode(ct) };
}

async function decryptMeta(key: CryptoKey, blob: EncMetaBlob): Promise<VaultProfileMeta> {
  const iv = b64Decode(blob.iv);
  const ct = b64Decode(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as VaultProfileMeta;
}

async function decodeStoredMeta(
  key: CryptoKey,
  raw: unknown,
): Promise<{ meta: VaultProfileMeta | null; needsRewrite: boolean }> {
  if (!raw) return { meta: null, needsRewrite: false };
  if (looksLikeEncBlob(raw)) {
    try {
      return { meta: await decryptMeta(key, raw), needsRewrite: false };
    } catch {
      return { meta: null, needsRewrite: false };
    }
  }
  if (looksLikePlainMeta(raw)) {
    return { meta: raw, needsRewrite: true };
  }
  return { meta: null, needsRewrite: false };
}

export function createIdbVaultBackend(): VaultBackend {
  return {
    async getMeta(address) {
      const db = await openDb();
      try {
        const key = await getOrCreateDeviceKey(db);
        const tx = db.transaction(META_STORE, "readonly");
        const raw = await idbReq(tx.objectStore(META_STORE).get(metaKey(address)));
        await txDone(tx);
        const { meta, needsRewrite } = await decodeStoredMeta(key, raw);
        if (meta && needsRewrite) {
          await this.putMeta(meta);
        }
        return meta;
      } finally {
        db.close();
      }
    },

    async putMeta(meta) {
      const db = await openDb();
      try {
        const key = await getOrCreateDeviceKey(db);
        const blob = await encryptMeta(key, meta);
        const tx = db.transaction(META_STORE, "readwrite");
        tx.objectStore(META_STORE).put(blob, metaKey(meta.aztecAddress));
        await txDone(tx);
      } finally {
        db.close();
      }
    },

    async listMeta() {
      const db = await openDb();
      try {
        const key = await getOrCreateDeviceKey(db);
        const tx = db.transaction(META_STORE, "readonly");
        const raw = await idbReq(tx.objectStore(META_STORE).getAll());
        await txDone(tx);
        const out: VaultProfileMeta[] = [];
        for (const item of raw as unknown[]) {
          const { meta, needsRewrite } = await decodeStoredMeta(key, item);
          if (!meta) continue;
          out.push(meta);
          if (needsRewrite) {
            await this.putMeta(meta);
          }
        }
        return out.filter(
          (m) => m && typeof m.aztecAddress === "string" && typeof m.verifier === "string",
        );
      } finally {
        db.close();
      }
    },

    async getDoc(address, docId) {
      const db = await openDb();
      try {
        const tx = db.transaction(DOCS_STORE, "readonly");
        const raw = await idbReq(tx.objectStore(DOCS_STORE).get(docKey(address, docId)));
        await txDone(tx);
        return (raw as VaultEnvelope | undefined) ?? null;
      } finally {
        db.close();
      }
    },

    async putDoc(address, docId, envelope) {
      const db = await openDb();
      try {
        const tx = db.transaction(DOCS_STORE, "readwrite");
        tx.objectStore(DOCS_STORE).put(envelope, docKey(address, docId));
        await txDone(tx);
      } finally {
        db.close();
      }
    },

    async deleteDoc(address, docId) {
      const db = await openDb();
      try {
        const tx = db.transaction(DOCS_STORE, "readwrite");
        tx.objectStore(DOCS_STORE).delete(docKey(address, docId));
        await txDone(tx);
      } finally {
        db.close();
      }
    },

    async listDocIds(address) {
      const db = await openDb();
      try {
        const prefix = `${address.trim().toLowerCase()}:`;
        const tx = db.transaction(DOCS_STORE, "readonly");
        const keys = await idbReq(tx.objectStore(DOCS_STORE).getAllKeys());
        await txDone(tx);
        return keys
          .map((k) => String(k))
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length));
      } finally {
        db.close();
      }
    },

    async deleteProfile(address) {
      const db = await openDb();
      try {
        const addr = address.trim().toLowerCase();
        const prefix = `${addr}:`;
        const tx = db.transaction([META_STORE, DOCS_STORE], "readwrite");
        tx.objectStore(META_STORE).delete(metaKey(address));
        const keys = await idbReq(tx.objectStore(DOCS_STORE).getAllKeys());
        for (const k of keys) {
          if (String(k).startsWith(prefix)) tx.objectStore(DOCS_STORE).delete(k);
        }
        await txDone(tx);
      } finally {
        db.close();
      }
    },
  };
}

/** In-memory backend for vitest (no IndexedDB required). */
export function createMemoryVaultBackend(): VaultBackend {
  const meta = new Map<string, VaultProfileMeta>();
  const docs = new Map<string, VaultEnvelope>();
  return {
    async getMeta(address) {
      return meta.get(metaKey(address)) ?? null;
    },
    async putMeta(m) {
      meta.set(metaKey(m.aztecAddress), m);
    },
    async listMeta() {
      return [...meta.values()];
    },
    async getDoc(address, docId) {
      return docs.get(docKey(address, docId)) ?? null;
    },
    async putDoc(address, docId, envelope) {
      docs.set(docKey(address, docId), envelope);
    },
    async deleteDoc(address, docId) {
      docs.delete(docKey(address, docId));
    },
    async listDocIds(address) {
      const prefix = `${address.trim().toLowerCase()}:`;
      return [...docs.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    async deleteProfile(address) {
      meta.delete(metaKey(address));
      const prefix = `${address.trim().toLowerCase()}:`;
      for (const k of [...docs.keys()]) {
        if (k.startsWith(prefix)) docs.delete(k);
      }
    },
  };
}
