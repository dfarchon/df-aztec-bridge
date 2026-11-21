import { describe, expect, it, vi } from "vitest";
import { type Hex } from "viem";
import { sendPortalSteps, type PortalSequence } from "./portal-sequence.ts";

const sender = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const portal = "0x3333333333333333333333333333333333333333";
const treasury = "0x4444444444444444444444444444444444444444";
const secretHash = ("0x" + "ab".repeat(32)) as Hex;
const deposit = { portal, recipient: "0x56", claimSecretHash: secretHash, claimAmount: "95" } as const;

function scenario() {
  let sequence: PortalSequence = {
    plan: { sender, grossAmount: "100", ethServiceFee: "37", claimSecretHash: secretHash }, attempts: {},
  };
  let interruptAt = -1;
  let revertAt = -1;
  let mempoolNonce = 0;
  type Tx = { hash: Hex; blockNumber: bigint; from: Hex; to: Hex; value: bigint; input: Hex; nonce: number };
  const chain: Tx[] = [];
  const getReceipt = async ({ hash }: { hash: Hex }) => {
    const tx = chain.find(tx => tx.hash === hash)!;
    return { transactionHash: tx.hash, status: tx.nonce === revertAt ? "reverted" : "success" };
  };
  const publicClient = {
    getBlockNumber: async () => BigInt(chain.length + 10),
    getTransactionCount: async ({ blockNumber }: { blockNumber?: bigint }) => blockNumber === undefined
      ? Math.max(chain.length, mempoolNonce) : chain.filter(tx => tx.blockNumber <= blockNumber).length,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ transactions: chain.filter(tx => tx.blockNumber === blockNumber) }),
    getTransaction: async ({ hash }: { hash: Hex }) => chain.find(tx => tx.hash === hash),
    getTransactionReceipt: getReceipt,
    readContract: vi.fn(async () => 0n),
  };
  const walletClient = {
    sendTransaction: vi.fn(async (call: { nonce: number; to: Hex; data: Hex; value: bigint }) => {
      // The write-ahead record must already be durable before the wallet is invoked.
      expect(Object.values(sequence.attempts).some(attempt => attempt.nonce === call.nonce && !attempt.hash)).toBe(true);
      expect(call.nonce).toBe(chain.length);
      const hash = ("0x" + String(call.nonce + 1).padStart(64, "0")) as Hex;
      chain.push({ hash, from: sender, nonce: call.nonce, blockNumber: BigInt(11 + call.nonce),
        to: call.to, value: call.value, input: call.data });
      if (call.nonce === interruptAt) throw new Error("tab closed after broadcast");
      return hash;
    }),
  };
  const run = () => sendPortalSteps({
    clients: { account: sender, publicClient, walletClient, chain: { id: 1 } } as unknown as Parameters<typeof sendPortalSteps>[0]["clients"],
    token, deposit, feeRecipient: treasury, sequence: structuredClone(sequence), progress: () => {},
    checkpoint: async state => { sequence = structuredClone(state); },
  });
  return { run, chain, walletClient, publicClient, sequence: () => sequence,
    interrupt: (nonce: number) => { interruptAt = nonce; }, revert: (nonce: number) => { revertAt = nonce; },
    pending: (nonce: number) => { mempoolNonce = nonce; },
  };
}

describe("resuming sequential portal payments", () => {
  it.each([0, 1, 2, 3])("resolves a mined transaction after losing the wallet response at step %i", async step => {
    const s = scenario();
    s.interrupt(step);
    await expect(s.run()).rejects.toThrow("tab closed");
    expect(s.sequence().attempts[["ethFee", "tokenFee", "approval", "deposit"][step] as keyof PortalSequence["attempts"]]?.hash).toBeUndefined();
    if (step >= 2) s.publicClient.readContract.mockResolvedValue(95n);
    const hash = await s.run();
    expect(s.chain.map(tx => tx.to)).toEqual([treasury, token, token, portal]);
    expect(s.chain[0].value).toBe(37n);
    expect(hash).toBe(s.chain[3].hash);
    s.publicClient.readContract.mockResolvedValue(0n);
    expect(await s.run()).toBe(hash);
    expect(s.walletClient.sendTransaction).toHaveBeenCalledTimes(4);
  });

  it("waits for an unresolved nonce and never pays on an ambiguous RPC result", async () => {
    const s = scenario();
    s.walletClient.sendTransaction.mockRejectedValueOnce(new Error("lost wallet connection"));
    await expect(s.run()).rejects.toThrow("lost wallet connection");
    s.pending(1);
    await expect(s.run()).rejects.toThrow("awaiting confirmation");
    expect(s.walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("stops when the mined transaction does not match the expected fee", async () => {
    const s = scenario();
    s.interrupt(0);
    await expect(s.run()).rejects.toThrow("tab closed");
    s.chain[0].value = 36n;
    await expect(s.run()).rejects.toThrow("differs from the saved ETH service fee");
    expect(s.walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries only the reverted step and retains the ETH fee amount", async () => {
    const s = scenario();
    s.revert(1);
    await expect(s.run()).rejects.toThrow("AZTEC protocol fee reverted");
    await s.run();
    expect(s.chain.map(tx => tx.to)).toEqual([treasury, token, token, token, portal]);
    expect(s.chain[2].input).toBe(s.chain[1].input);
  });
});
