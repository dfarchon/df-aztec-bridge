import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listIncompleteSessions,
  removeSession,
  upsertSession,
} from "./bridge-session.ts";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import { resetVaultSession, setVaultBackend, setupVault } from "./vault.ts";

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

const credentials = {
  claimSecret: SECRET,
  claimSecretHash: SECRET_HASH,
  messageHash: MESSAGE_HASH,
  messageLeafIndex: "7",
  claimAmount: "500000000000000000",
  recipient: RECIPIENT,
};

describe("recovery flow sessions", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    setVaultBackend(createMemoryVaultBackend());
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

  it("keeps L1-pending and claim-sent bridges side by side", async () => {
    await upsertSession("mainnet", {
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
    await upsertSession("mainnet", {
      l1TxHash: L1_SENT,
      phase: "claim-sent",
      recipient: RECIPIENT,
      claimAmount: "1",
      credentials,
      l2TxHash: L2_TX,
    });
    const sessions = await listIncompleteSessions("mainnet");
    expect(sessions).toHaveLength(2);
  });

  it("tracks claiming interrupted then ready-to-claim", async () => {
    await upsertSession("mainnet", {
      l1TxHash: L1_CLAIM,
      phase: "claiming",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
      claimChannel: "browser",
    });
    await upsertSession("mainnet", {
      l1TxHash: L1_CLAIM,
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
    });
    const [session] = await listIncompleteSessions("mainnet");
    expect(session?.phase).toBe("ready-to-claim");
  });

  it("treats consumed/success as removeSession of only that L1 hash", async () => {
    await upsertSession("mainnet", {
      l1TxHash: L1_CLAIM,
      phase: "ready-to-claim",
      recipient: RECIPIENT,
      claimAmount: credentials.claimAmount,
      credentials,
    });
    await upsertSession("mainnet", {
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
    await removeSession("mainnet", L1_CLAIM);
    const remaining = await listIncompleteSessions("mainnet");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.l1TxHash.toLowerCase()).toBe(L1_PENDING.toLowerCase());
  });
});
