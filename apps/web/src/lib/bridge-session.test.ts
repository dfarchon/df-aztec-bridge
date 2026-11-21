import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBridgeStorageReady,
  BridgeStorageError,
  clearAllSessions,
  getActiveSession,
  listIncompleteSessions,
  readVaultClaimsForExport,
  loadSessionStore,
  normalizeL1TxHash,
  removeSession,
  saveBridgeSession,
  setActiveSession,
  upsertSession,
  validateSessionEntry,
} from "./bridge-session.ts";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import { listPreparedDeposits, savePreparedDeposit, removePreparedDeposit } from "./prepared-deposit.ts";
import { accountClaimKey } from "./claim-copy.ts";
import { decryptJson } from "./vault-crypto.ts";
import { claimExportAvailability, isVaultUnlocked, lockVault, recoverClaimsWithAccount, resetVaultSession, setVaultBackend, setupVault, unlockVault, vaultGetJson, vaultSetJson } from "./vault.ts";

const L1_A =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const L1_B =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SECRET_HASH =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const MESSAGE_HASH =
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const L2_TX =
  "0x4444444444444444444444444444444444444444444444444444444444444444";
const RECIPIENT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const VAULT_ADDR = "0x9999999999999999999999999999999999999999999999999999999999999999";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function pending(l1 = L1_A) {
  return {
    l1TxHash: l1,
    claimSecret: SECRET,
    claimSecretHash: SECRET_HASH,
    claimAmount: "1000000000000000000",
    recipient: RECIPIENT,
  };
}

function credentials() {
  return {
    claimSecret: SECRET,
    claimSecretHash: SECRET_HASH,
    messageHash: MESSAGE_HASH,
    messageLeafIndex: "42",
    claimAmount: "1000000000000000000",
    recipient: RECIPIENT,
  };
}

describe("bridge-session v2 store", () => {
  let storage: ReturnType<typeof createMemoryVaultBackend>;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    storage = createMemoryVaultBackend();
    setVaultBackend(storage);
    resetVaultSession();
    await setupVault({
      aztecAddress: VAULT_ADDR,
      password: "test-password-ok",
      signingKey: "0xsign",
    });
  });

  afterEach(() => {
    resetVaultSession();
    vi.unstubAllGlobals();
  });

  it("keeps independent pre-signature deposits across lock and reload, including JSON-only recovery", async () => {
    const account = { address: VAULT_ADDR, secretKey: SECRET_HASH, salt: "0x0" };
    await vaultSetJson("wallets", { accounts: [account], activeAddress: VAULT_ADDR });
    const deposit = {
      recipient: VAULT_ADDR, claimAmount: "95", portal: RECIPIENT, fromBlock: "10", chainId: 31337,
      claimSecret: SECRET, claimSecretHash: SECRET_HASH,
    } as const;
    await Promise.all([
      savePreparedDeposit("local", deposit),
      savePreparedDeposit("local", { ...deposit, claimSecretHash: L1_B }),
    ]);
    resetVaultSession();
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("available");
    expect(await recoverClaimsWithAccount(VAULT_ADDR, account)).toEqual(expect.arrayContaining([
      expect.objectContaining({ prepared: expect.objectContaining({ deposit }) }),
    ]));
    expect(isVaultUnlocked()).toBe(false);
    await unlockVault({ aztecAddress: VAULT_ADDR, password: "test-password-ok" });
    expect(await listPreparedDeposits("mainnet")).toHaveLength(0);
    expect(await listPreparedDeposits("local")).toHaveLength(2);
    await removePreparedDeposit(SECRET_HASH);
    expect((await listPreparedDeposits("local"))[0]?.deposit.claimSecretHash).toBe(L1_B);
  });

  it("uses the original JSON to export only current claim data while the vault stays locked", async () => {
    const storage = createMemoryVaultBackend();
    setVaultBackend(storage);
    const account = { address: VAULT_ADDR, secretKey: SECRET_HASH, salt: "0x00", signingKey: L1_B };
    const wallets = { accounts: [account], activeAddress: VAULT_ADDR };
    const password = "test-password-ok";
    await setupVault({ aztecAddress: VAULT_ADDR, password, imported: { wallets, expectedSalt: null } });
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("empty");
    await assertBridgeStorageReady();
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("empty");
    await vaultSetJson("rpc", { privateValue: "secret RPC" });
    await upsertSession("test-a", {
      l1TxHash: L1_A, recipient: RECIPIENT, claimAmount: "1000000000000000000",
      phase: "l1-pending", pending: pending(),
    });
    lockVault();
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("available");
    expect(await recoverClaimsWithAccount(VAULT_ADDR, account)).toEqual([
      { networkId: "test-a", l1TxHash: L1_A, pending: pending() },
    ]);
    await expect(recoverClaimsWithAccount(VAULT_ADDR, { ...account, secretKey: L1_A })).rejects.toThrow("original");
    await expect(recoverClaimsWithAccount(VAULT_ADDR, { ...account, address: L1_A })).rejects.toThrow("original");
    expect(isVaultUnlocked()).toBe(false);
    await expect(vaultGetJson("wallets")).rejects.toThrow("locked");
    const recoveryKey = (await accountClaimKey(VAULT_ADDR, account))!;
    await expect(decryptJson(recoveryKey, (await storage.getDoc(VAULT_ADDR, "wallets"))!)).rejects.toThrow();
    expect((await storage.getDoc(VAULT_ADDR, "rpc"))!.claimCopy).toBeUndefined();
    const envelope = (await storage.getDoc(VAULT_ADDR, "bridge:test-a"))!;
    expect(JSON.stringify(envelope)).not.toContain(SECRET);
    const { hasClaims, ...unmarkedCopy } = envelope.claimCopy!;
    expect(hasClaims).toBe(true);
    await storage.putDoc(VAULT_ADDR, "bridge:test-a", { ...envelope, claimCopy: unmarkedCopy });
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("unknown");
    expect(await claimExportAvailability(VAULT_ADDR, account)).toBe("available");
    // Simulate a profile from an older release. Unlock must backfill without changing its documents.
    for (const id of ["wallets", "bridge:test-a"]) {
      const original = (await storage.getDoc(VAULT_ADDR, id))!;
      const { claimCopy, ...legacy } = original;
      expect(claimCopy).toBeDefined();
      await storage.putDoc(VAULT_ADDR, id, legacy);
    }
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("needs-unlock");
    await expect(recoverClaimsWithAccount(VAULT_ADDR, account)).rejects.toThrow("Unlock this vault once");
    await unlockVault({ aztecAddress: VAULT_ADDR, password });
    lockVault();
    expect(await recoverClaimsWithAccount(VAULT_ADDR, account)).toHaveLength(1);
    expect((await storage.getDoc(VAULT_ADDR, "bridge:test-a"))!.ct).toEqual(envelope.ct);
    await unlockVault({ aztecAddress: VAULT_ADDR, password });
    await upsertSession("test-a", {
      l1TxHash: L1_A, recipient: RECIPIENT, claimAmount: "1000000000000000000",
      phase: "ready-to-claim", credentials: credentials(), lastError: "private diagnostic",
    });
    lockVault();
    const recovered = await recoverClaimsWithAccount(VAULT_ADDR, account);
    expect(recovered[0]?.credentials).toEqual(credentials());
    expect(JSON.stringify(recovered)).not.toContain("private diagnostic");
    await unlockVault({ aztecAddress: VAULT_ADDR, password });
    await clearAllSessions("test-a");
    lockVault();
    expect(await claimExportAvailability(VAULT_ADDR)).toBe("empty");
    expect(await recoverClaimsWithAccount(VAULT_ADDR, account)).toEqual([]);
  });

  it("exports pending and ready claims across networks only from the selected unlocked vault", async () => {
    for (const networkId of ["test-a", "test-b"]) {
      await upsertSession(networkId, {
        l1TxHash: L1_A, recipient: RECIPIENT, claimAmount: "1000000000000000000",
        ...(networkId === "test-a"
          ? { phase: "ready-to-claim", credentials: credentials() }
          : { phase: "l1-pending", pending: pending() }),
      });
    }
    expect(await readVaultClaimsForExport(VAULT_ADDR)).toEqual(expect.arrayContaining([
      expect.objectContaining({ networkId: "test-a", credentials: credentials() }),
      expect.objectContaining({ networkId: "test-b", pending: pending() }),
    ]));
    await expect(readVaultClaimsForExport("0x1234")).rejects.toThrow("Unlock");
    lockVault();
    await expect(readVaultClaimsForExport(VAULT_ADDR)).rejects.toThrow("Unlock");
  });

  it("migrates v1 single session to v2 multi-session store", async () => {
    localStorage.setItem(
      "df_aztec_bridge_session",
      JSON.stringify({
        version: 1,
        networkId: "mainnet",
        timestamp: 1_700_000_000_000,
        l1TxHash: L1_A,
        claimPhase: "l1-pending",
        pending: pending(),
      }),
    );

    const store = await loadSessionStore("mainnet");
    expect(store.version).toBe(2);
    expect(store.activeL1TxHash).toBe(normalizeL1TxHash(L1_A));
    expect(Object.keys(store.sessions)).toEqual([normalizeL1TxHash(L1_A)]);
    expect(localStorage.getItem("df_aztec_bridge_session")).toBeNull();
  });

  it("keeps the legacy source when writing its migrated copy fails", async () => {
    const entry = await saveBridgeSession({ networkId: "testnet", l1TxHash: L1_A, pending: pending() });
    const legacy = JSON.stringify({
      version: 2, networkId: "mainnet", updatedAt: entry.updatedAt, activeL1TxHash: L1_A,
      sessions: { [L1_A]: { ...entry, networkId: "mainnet" } },
    });
    const key = "df_aztec_bridge_sessions:mainnet";
    localStorage.setItem(key, legacy);
    vi.spyOn(storage, "putDoc").mockRejectedValueOnce(new Error("Vault write failed"));

    await expect(setActiveSession("mainnet", L1_A)).rejects.toThrow("Vault write failed");
    expect(localStorage.getItem(key)).toBe(legacy);
    expect((await loadSessionStore("mainnet")).sessions[L1_A].pending).toEqual(pending());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("drops leftover plaintext while the vault is locked", async () => {
    lockVault();
    localStorage.setItem(
      "df_aztec_bridge_session",
      JSON.stringify({
        version: 1,
        networkId: "mainnet",
        timestamp: 1_700_000_000_000,
        l1TxHash: L1_A,
        claimPhase: "l1-pending",
        pending: pending(),
      }),
    );
    const store = await loadSessionStore("mainnet");
    expect(store.sessions).toEqual({});
    expect(localStorage.getItem("df_aztec_bridge_session")).toBeNull();
  });

  it("keeps multiple incomplete sessions and removes one", async () => {
    await upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_A),
    });
    await upsertSession("mainnet", {
      l1TxHash: L1_B,
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: "2",
      credentials: credentials(),
    });

    const sessions = await listIncompleteSessions("mainnet");
    expect(sessions).toHaveLength(2);
    await removeSession("mainnet", L1_A);
    const remaining = await listIncompleteSessions("mainnet");
    expect(remaining.map((s) => s.l1TxHash)).toEqual([normalizeL1TxHash(L1_B)]);
  });

  it("preserves the existing claim on a transient read failure and saves both on retry", async () => {
    const save = (l1TxHash: string) => saveBridgeSession({
      networkId: "mainnet", l1TxHash, pending: pending(l1TxHash),
    });
    await save(L1_A);
    const id = "bridge:mainnet";
    const before = await storage.getDoc(VAULT_ADDR, id);
    const getDoc = storage.getDoc.bind(storage);
    const read = vi.spyOn(storage, "getDoc").mockImplementation(async (address, docId) => {
      if (docId === id) {
        read.mockRestore();
        throw new Error("Temporary vault read failure");
      }
      return getDoc(address, docId);
    });

    await expect(save(L1_B)).rejects.toThrow("Temporary vault read failure");
    expect(await storage.getDoc(VAULT_ADDR, id)).toEqual(before);
    await save(L1_B);
    const store = await loadSessionStore("mainnet");
    expect(store.sessions[L1_A].pending).toEqual(pending(L1_A));
    expect(store.sessions[L1_B].pending).toEqual(pending(L1_B));
  });

  it("preserves createdAt across upserts", async () => {
    await upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(),
    });
    const createdAt = (await getActiveSession("mainnet"))!.createdAt;
    await upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: "1",
      credentials: credentials(),
    });
    const sessions = await listIncompleteSessions("mainnet");
    expect(sessions[0]!.createdAt).toBe(createdAt);
  });

  it("validateSessionEntry accepts claim-sent with l2 hash", () => {
    const entry = validateSessionEntry({
      l1TxHash: L1_A,
      createdAt: 1,
      updatedAt: 2,
      phase: "claim-sent",
      networkId: "mainnet",
      recipient: RECIPIENT,
      claimAmount: "1",
      credentials: credentials(),
      l2TxHash: L2_TX,
    });
    expect(entry.phase).toBe("claim-sent");
  });

  it("validateSessionEntry rejects claim-sent without l2", () => {
    expect(() =>
      validateSessionEntry({
        l1TxHash: L1_A,
        createdAt: 1,
        updatedAt: 2,
        phase: "claim-sent",
        networkId: "mainnet",
        recipient: RECIPIENT,
        claimAmount: "1",
        credentials: credentials(),
      }),
    ).toThrow(BridgeStorageError);
  });

  it("shows readable claims but refuses to rewrite a partially corrupt store", async () => {
    const entry = await saveBridgeSession({ networkId: "mainnet", l1TxHash: L1_A, pending: pending() });
    const id = "bridge:mainnet";
    const store = await loadSessionStore("mainnet");
    const damaged = { ...store, sessions: { ...store.sessions, [L1_B]: { phase: "l1-pending" } } };
    await vaultSetJson(id, damaged);

    expect(await listIncompleteSessions("mainnet")).toEqual([entry]);
    await expect(setActiveSession("mainnet", null)).rejects.toThrow(BridgeStorageError);
    await expect(removeSession("mainnet", L1_A)).rejects.toThrow(BridgeStorageError);
    await expect(saveBridgeSession({ networkId: "mainnet", l1TxHash: L1_B, pending: pending(L1_B) }))
      .rejects.toThrow(BridgeStorageError);
    expect(await vaultGetJson(id)).toEqual(damaged);
  });

  it("assertBridgeStorageReady succeeds when vault unlocked", async () => {
    await expect(assertBridgeStorageReady()).resolves.toBeUndefined();
  });

  it("saveBridgeSession writes active credentials session", async () => {
    await saveBridgeSession({
      networkId: "mainnet",
      l1TxHash: L1_A,
      claimPhase: "ready-to-claim",
      credentials: credentials(),
    });
    const active = await getActiveSession("mainnet");
    expect(active?.credentials?.messageHash).toBe(MESSAGE_HASH);
  });

  it("scopes sessions per network", async () => {
    await upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_A),
    });
    await upsertSession("testnet", {
      l1TxHash: L1_B,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_B),
    });
    expect((await listIncompleteSessions("mainnet")).map((s) => s.l1TxHash)).toEqual([
      normalizeL1TxHash(L1_A),
    ]);
    expect((await listIncompleteSessions("testnet")).map((s) => s.l1TxHash)).toEqual([
      normalizeL1TxHash(L1_B),
    ]);
  });

  it("clearAllSessions only wipes the selected network", async () => {
    await upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_A),
    });
    await upsertSession("testnet", {
      l1TxHash: L1_B,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_B),
    });
    await clearAllSessions("mainnet");
    expect(await listIncompleteSessions("mainnet")).toHaveLength(0);
    expect(await listIncompleteSessions("testnet")).toHaveLength(1);
  });
});
