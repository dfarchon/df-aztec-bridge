import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumePendingBridge } from "@df-bridge/browser-sdk";
import { encodeAbiParameters, toEventSelector, type EIP1193Provider } from "viem";
import { getNetwork } from "../config/networks.ts";
import { importPendingClaimFile } from "./claim-credentials-import.ts";
import {
  listIncompleteSessions,
  removeSession,
  upsertSession,
} from "./bridge-session.ts";
import { createMemoryVaultBackend } from "./vault-idb.ts";
import { lockVault, resetVaultSession, setVaultBackend, setupVault, unlockVault, vaultSetJson } from "./vault.ts";

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

  const network = getNetwork("mainnet");
  const pendingBackup = {
    version: 1, networkId: network.id,
    pending: {
      l1TxHash: L1_PENDING, claimSecret: SECRET, claimSecretHash: SECRET_HASH,
      claimAmount: "95", recipient: VAULT_ADDR, portal: network.l1Addresses.feeJuicePortal,
    },
  };

  it("recovers a pending export in a fresh vault and keeps subsequent L2 progress on re-import", async () => {
    const account = { address: VAULT_ADDR, secretKey: SECRET, salt: "0x0" };
    await vaultSetJson("wallets", { accounts: [account], activeAddress: VAULT_ADDR });
    await importPendingClaimFile(pendingBackup, network);
    lockVault();
    await unlockVault({ aztecAddress: VAULT_ADDR, password: "test-password-ok" });
    const [saved] = await listIncompleteSessions(network.id);
    expect(saved?.pending).toEqual(pendingBackup.pending);
    const duplicate = { ...pendingBackup, pending: { ...pendingBackup.pending, claimSecret: SECRET_HASH } };
    expect((await importPendingClaimFile(duplicate, network)).pending).toEqual(saved.pending);

    const request = vi.fn(async (_rpc: { method: string; params?: unknown }) => ({
      from: RECIPIENT,
      logs: [{
        address: network.l1Addresses.feeJuicePortal,
        topics: [toEventSelector("DepositToAztecPublic(bytes32,uint256,bytes32,bytes32,uint256)"), VAULT_ADDR],
        data: encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
          [95n, SECRET_HASH, MESSAGE_HASH, 7n],
        ),
      }],
    }));
    const result = await resumePendingBridge({
      pending: saved.pending!, chainId: network.l1ChainId, l1RpcUrl: network.l1RpcUrl,
      provider: { request } as unknown as EIP1193Provider,
    });
    expect(request.mock.calls.map(([rpc]) => rpc)).toEqual([
      { method: "eth_getTransactionReceipt", params: [L1_PENDING] },
    ]);
    expect(result.credentials).toMatchObject({ claimSecret: SECRET, messageHash: MESSAGE_HASH, messageLeafIndex: "7" });
    const ready = await upsertSession(network.id, {
      l1TxHash: result.l1TxHash, recipient: VAULT_ADDR, claimAmount: "95",
      credentials: result.credentials, phase: "ready-to-claim", preserveExisting: true,
    });
    expect(await importPendingClaimFile(pendingBackup, network)).toEqual(ready);
    const sent = await upsertSession(network.id, { ...ready, phase: "claim-sent", l2TxHash: L2_TX });
    expect(await importPendingClaimFile(pendingBackup, network)).toEqual(sent);
  });

  it("checks the network, portal, payload and recipient before storing an imported pending claim", async () => {
    await expect(importPendingClaimFile(pendingBackup, getNetwork("testnet"))).rejects.toThrow("original deposit network");
    for (const portal of [RECIPIENT, "invalid"]) {
      await expect(importPendingClaimFile({ ...pendingBackup, pending: { ...pendingBackup.pending, portal } }, network))
        .rejects.toThrow("portal");
    }
    await expect(importPendingClaimFile({ ...pendingBackup, pending: { ...pendingBackup.pending, claimSecret: "" } }, network))
      .rejects.toThrow("secrets");
    await expect(importPendingClaimFile(pendingBackup, network)).rejects.toThrow("account is not in this browser");
    expect(await listIncompleteSessions(network.id)).toEqual([]);
    await vaultSetJson("wallets", { accounts: [{ address: VAULT_ADDR, secretKey: SECRET, salt: "0x0" }] });
    // Earlier pending exports did not always record the portal.
    const { portal, ...legacy } = pendingBackup.pending;
    expect((await importPendingClaimFile({ ...pendingBackup, pending: legacy }, network)).pending?.portal).toBe(portal);
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
