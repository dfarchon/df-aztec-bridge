import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBridgeStorageReady,
  BridgeStorageError,
  clearAllSessions,
  getActiveSession,
  listIncompleteSessions,
  loadSessionStore,
  normalizeL1TxHash,
  removeSession,
  saveBridgeSession,
  upsertSession,
  validateSessionEntry,
} from "./bridge-session.js";

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
const storeKey = (networkId: string) => `df_aztec_bridge_sessions:${networkId}`;

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
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates v1 single session to v2 multi-session store", () => {
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

    const store = loadSessionStore("mainnet");
    expect(store.version).toBe(2);
    expect(store.activeL1TxHash).toBe(normalizeL1TxHash(L1_A));
    expect(Object.keys(store.sessions)).toHaveLength(1);
    expect(store.sessions[normalizeL1TxHash(L1_A)]?.phase).toBe("l1-pending");
    expect(localStorage.getItem("df_aztec_bridge_session")).toBeNull();
    expect(localStorage.getItem(storeKey("mainnet"))).toBeTruthy();
  });

  it("upserts multiple sessions without overwriting siblings", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_A),
    });
    upsertSession("mainnet", {
      l1TxHash: L1_B,
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: "2",
      credentials: { ...credentials(), claimAmount: "2" },
    });

    const sessions = listIncompleteSessions("mainnet");
    expect(sessions).toHaveLength(2);
    removeSession("mainnet", L1_A);
    const remaining = listIncompleteSessions("mainnet");
    expect(remaining).toHaveLength(1);
    expect(normalizeL1TxHash(remaining[0]!.l1TxHash)).toBe(normalizeL1TxHash(L1_B));
  });

  it("merges idempotently on the same L1 tx hash", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(),
    });
    const createdAt = getActiveSession("mainnet")!.createdAt;
    upsertSession("mainnet", {
      l1TxHash: L1_A.toUpperCase(),
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: "1",
      credentials: credentials(),
    });
    const sessions = listIncompleteSessions("mainnet");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.phase).toBe("ready-to-claim");
    expect(sessions[0]!.createdAt).toBe(createdAt);
  });

  it("rejects phase/payload mismatches", () => {
    expect(() =>
      validateSessionEntry({
        l1TxHash: L1_A,
        createdAt: 1,
        updatedAt: 1,
        phase: "claim-sent",
        networkId: "mainnet",
        recipient: RECIPIENT,
        claimAmount: "1",
        credentials: credentials(),
      }),
    ).toThrow(/L2 tx hash/i);

    expect(() =>
      validateSessionEntry({
        l1TxHash: L1_A,
        createdAt: 1,
        updatedAt: 1,
        phase: "l1-pending",
        networkId: "mainnet",
        recipient: RECIPIENT,
        claimAmount: "1",
        pending: pending(),
        credentials: credentials(),
      }),
    ).toThrow(/pending data only/i);
  });

  it("drops corrupt sessions but keeps valid siblings", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_A),
    });
    const raw = JSON.parse(localStorage.getItem(storeKey("mainnet"))!);
    raw.sessions[normalizeL1TxHash(L1_B)] = { broken: true };
    localStorage.setItem(storeKey("mainnet"), JSON.stringify(raw));

    const sessions = listIncompleteSessions("mainnet");
    expect(sessions).toHaveLength(1);
    expect(normalizeL1TxHash(sessions[0]!.l1TxHash)).toBe(normalizeL1TxHash(L1_A));
  });

  it("blocks when storage probe fails", () => {
    const broken: Storage = {
      length: 0,
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    vi.stubGlobal("localStorage", broken);
    expect(() => assertBridgeStorageReady()).toThrow(BridgeStorageError);
  });

  it("persists claim-sent with l2TxHash for resume", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "claim-sent",
      recipient: RECIPIENT,
      claimAmount: "1",
      credentials: credentials(),
      l2TxHash: L2_TX,
      claimChannel: "browser",
    });
    const active = getActiveSession("mainnet");
    expect(active?.phase).toBe("claim-sent");
    expect(active?.l2TxHash).toBe(L2_TX);
  });

  it("persists complete claim credentials after an L1 bridge", () => {
    saveBridgeSession({
      networkId: "mainnet",
      l1TxHash: L1_A,
      claimPhase: "ready-to-claim",
      credentials: credentials(),
    });

    const active = getActiveSession("mainnet");
    expect(active?.phase).toBe("ready-to-claim");
    expect(active?.credentials).toEqual(credentials());
    expect(localStorage.getItem(storeKey("mainnet"))).toContain(MESSAGE_HASH);
  });

  it("keeps each network in a separate store", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_A),
    });
    upsertSession("testnet", {
      l1TxHash: L1_B,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_B),
    });

    expect(listIncompleteSessions("mainnet").map((session) => session.l1TxHash)).toEqual([L1_A]);
    expect(listIncompleteSessions("testnet").map((session) => session.l1TxHash)).toEqual([L1_B]);
  });

  it("clearAllSessions only wipes the selected network", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_A,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(),
    });
    upsertSession("testnet", {
      l1TxHash: L1_B,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: pending(L1_B),
    });
    clearAllSessions("mainnet");
    expect(listIncompleteSessions("mainnet")).toHaveLength(0);
    expect(listIncompleteSessions("testnet")).toHaveLength(1);
  });
});
