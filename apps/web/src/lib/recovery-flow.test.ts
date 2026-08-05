import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listIncompleteSessions,
  removeSession,
  upsertSession,
} from "./bridge-session.js";

const L1_PENDING =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const L1_CLAIM =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const L1_SENT =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SECRET =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SECRET_HASH =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const MESSAGE_HASH =
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const L2_TX =
  "0x4444444444444444444444444444444444444444444444444444444444444444";
const RECIPIENT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

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

const credentials = {
  claimSecret: SECRET,
  claimSecretHash: SECRET_HASH,
  messageHash: MESSAGE_HASH,
  messageLeafIndex: "7",
  claimAmount: "500000000000000000",
  recipient: RECIPIENT,
};

/**
 * Recovery flow coverage without React: L1 pending, ready, claiming interrupted,
 * claim-sent (L2 mining), consumed cleanup, and two unfinished bridges coexisting.
 */
describe("recovery flow sessions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps L1-pending and claim-sent bridges side by side", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_PENDING,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: {
        l1TxHash: L1_PENDING,
        claimSecret: SECRET,
        claimSecretHash: SECRET_HASH,
        claimAmount: "1",
        recipient: RECIPIENT,
      },
    });
    upsertSession("mainnet", {
      l1TxHash: L1_SENT,
      phase: "claim-sent",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
      l2TxHash: L2_TX,
      claimChannel: "browser",
    });

    const sessions = listIncompleteSessions("mainnet");
    expect(sessions.map((s) => s.phase).sort()).toEqual(["claim-sent", "l1-pending"]);
  });

  it("marks claiming interruption as failed while retaining credentials", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_CLAIM,
      phase: "claiming",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
      claimChannel: "browser",
    });
    upsertSession("mainnet", {
      l1TxHash: L1_CLAIM,
      phase: "failed",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
      claimChannel: "browser",
      lastError: "Page refreshed during proving",
    });
    const [session] = listIncompleteSessions("mainnet");
    expect(session?.phase).toBe("failed");
    expect(session?.credentials?.messageHash).toBe(MESSAGE_HASH);
    expect(session?.lastError).toMatch(/proving/i);
  });

  it("treats consumed/success as removeSession of only that L1 hash", () => {
    upsertSession("mainnet", {
      l1TxHash: L1_CLAIM,
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
    });
    upsertSession("mainnet", {
      l1TxHash: L1_PENDING,
      phase: "l1-pending",
      recipient: RECIPIENT,
      claimAmount: "1",
      pending: {
        l1TxHash: L1_PENDING,
        claimSecret: SECRET,
        claimSecretHash: SECRET_HASH,
        claimAmount: "1",
        recipient: RECIPIENT,
      },
    });

    // Simulated: message already consumed / claim succeeded
    removeSession("mainnet", L1_CLAIM);
    const remaining = listIncompleteSessions("mainnet");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.phase).toBe("l1-pending");
  });
});
