/**
 * Native IndexedDB helpers for the password vault (no npm deps).
 */

import type { VaultEnvelope, VaultProfileMeta } from "./vault-crypto.ts";

export const VAULT_DB_NAME = "df-bridge-vault";
export const VAULT_DB_VERSION = 1;
export const META_STORE = "meta";
export const DOCS_STORE = "docs";

export type VaultBackend = {
  getMeta(address: string): Promise<VaultProfileMeta | null>;
  putMeta(meta: VaultProfileMeta): Promise<void>;
  getDoc(address: string, docId: string): Promise<VaultEnvelope | null>;
  putDoc(address: string, docId: string, envelope: VaultEnvelope): Promise<void>;
  deleteDoc(address: string, docId: string): Promise<void>;
  listDocIds(address: string): Promise<string[]>;
  deleteProfile(address: string): Promise<void>;
};

function metaKey(address: string): string {
  return `profile:${address.trim().toLowerCase()}`;
}

function docKey(address: string, docId: string): string {
  return `${address.trim().toLowerCase()}:${docId}`;
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

export function createIdbVaultBackend(): VaultBackend {
  return {
    async getMeta(address) {
      const db = await openDb();
      try {
        const tx = db.transaction(META_STORE, "readonly");
        const raw = await idbReq(tx.objectStore(META_STORE).get(metaKey(address)));
        await txDone(tx);
        return (raw as VaultProfileMeta | undefined) ?? null;
      } finally {
        db.close();
      }
    },

    async putMeta(meta) {
      const db = await openDb();
      try {
        const tx = db.transaction(META_STORE, "readwrite");
        tx.objectStore(META_STORE).put(meta, metaKey(meta.aztecAddress));
        await txDone(tx);
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
