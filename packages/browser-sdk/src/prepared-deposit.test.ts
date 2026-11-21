import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, toEventSelector, type EIP1193Provider, type Hex } from "viem";
import { bridgeFromConnectedWallet, findPreparedDeposit, resumePendingBridge } from "./bridge.ts";
import type { PreparedDeposit } from "./types.ts";

const mocks = vi.hoisted(() => ({
  getL1Clients: vi.fn(), getLogs: vi.fn(), getBlockNumber: vi.fn(), getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(), sendCalls: vi.fn(), waitForCallsStatus: vi.fn(), sendTransaction: vi.fn(), writeContract: vi.fn(),
}));
vi.mock("./clients.ts", async importOriginal => ({
  ...await importOriginal<typeof import("./clients.ts")>(),
  generateClaimSecret: async () => ({ secret: 123n, secretHash: 456n }),
  getL1PublicClient: () => mocks,
  getL1Clients: mocks.getL1Clients,
}));
vi.mock("viem/actions", async importOriginal => ({
  ...await importOriginal<typeof import("viem/actions")>(),
  sendCalls: mocks.sendCalls, waitForCallsStatus: mocks.waitForCallsStatus,
}));

const portal = ("0x" + "ab".repeat(20)) as Hex;
const params = {
  chainId: 31337, expectedChainId: 31337, amount: 100n, mint: false, aztecRecipient: "0x01",
  provider: {} as EIP1193Provider, feeRecipient: portal,
  addresses: { l1ChainId: 31337, feeAssetHandler: null, feeJuicePortal: portal, feeJuice: portal },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getChainId.mockResolvedValue(31337);
  mocks.getBlockNumber.mockResolvedValue(10n);
  mocks.getL1Clients.mockResolvedValue({
    publicClient: { readContract: async () => 0n },
    walletClient: { writeContract: mocks.writeContract, sendTransaction: mocks.sendTransaction }, account: portal, chain: { id: 31337 },
  });
});

describe("deposit preparation", () => {
  it.each(["portal", "gobridge"] as const)("blocks all wallet calls if %s preparation cannot be saved", async backend => {
    await expect(bridgeFromConnectedWallet({
      ...params, backend, onPrepared: async () => { throw new Error("Vault write failed"); },
    })).rejects.toThrow("Vault write failed");
    expect(mocks.getL1Clients).not.toHaveBeenCalled();
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("journals individual confirmations when the wallet cannot guarantee an atomic batch", async () => {
    mocks.sendCalls.mockRejectedValue({ cause: { code: 5760 } });
    const executeSequential = vi.fn(async () => { throw new Error("checkpoint written"); });
    await expect(bridgeFromConnectedWallet({ ...params, executeSequential })).rejects.toThrow("checkpoint written");
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
    expect(mocks.sendCalls.mock.calls[0][1].forceAtomic).toBe(true);
    expect(executeSequential.mock.calls[0]).toEqual([
      expect.objectContaining({ sender: portal, grossAmount: "100", ethServiceFee: "0" }), expect.any(Function),
    ]);
  });

  it("does not start separate payments after an ambiguous batch response", async () => {
    mocks.sendCalls.mockRejectedValue(new Error("wallet_sendCalls timed out"));
    const executeSequential = vi.fn();
    await expect(bridgeFromConnectedWallet({ ...params, executeSequential })).rejects.toThrow("timed out");
    expect(executeSequential).not.toHaveBeenCalled();
  });

  it.each(["batch", "sequential"])("keeps the secret before the first %s wallet confirmation", async mode => {
    let saved: PreparedDeposit | undefined;
    let release!: () => void;
    const commit = new Promise<void>(resolve => { release = resolve; });
    const prepare = vi.fn(async (deposit: PreparedDeposit) => { await commit; saved = deposit; });
    mocks.sendCalls.mockImplementation(async () => {
      expect(saved?.claimAmount).toBe("95");
      if (mode === "sequential") throw new Error("method not found");
      return { id: "0x01" };
    });
    mocks.waitForCallsStatus.mockRejectedValue(new Error("Tab closed before batch receipt"));
    mocks.sendTransaction.mockImplementation(async () => {
      expect(saved?.claimSecret).toMatch(/7b$/);
      throw new Error("Tab closed before transaction hash");
    });
    const result = bridgeFromConnectedWallet({ ...params, onPrepared: prepare });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(mocks.getL1Clients).not.toHaveBeenCalled();
    release();
    await expect(result).rejects.toThrow("Tab closed");
    expect(saved).toMatchObject({ fromBlock: "10", chainId: 31337, portal });
    expect(saved!.claimSecretHash).toMatch(/1c8$/);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(mode === "batch" ? 0 : 1);

    const hash = "0x" + "aa".repeat(32);
    mocks.getBlockNumber.mockResolvedValue(1500n);
    mocks.getLogs.mockResolvedValueOnce([{ args: { amount: 95n, secretHash: "0x1234" } }])
      .mockResolvedValueOnce([{ transactionHash: hash, args: { amount: 95n, secretHash: saved!.claimSecretHash } }]);
    const found = await findPreparedDeposit(saved!, 31337, "http://localhost");
    expect(found.hash).toBe(hash);
    expect(mocks.getLogs.mock.calls[0]![0]).toMatchObject({ address: portal, fromBlock: 10n, toBlock: 1009n });
    expect(mocks.getLogs.mock.calls[1]![0].fromBlock).toBe(1010n);
    const target = ("0x" + "1".padStart(64, "0")) as Hex;
    const key = ("0x" + "33".repeat(32)) as Hex;
    const log = {
      address: portal,
      topics: [toEventSelector("DepositToAztecPublic(bytes32,uint256,bytes32,bytes32,uint256)"), target],
      data: encodeAbiParameters([{type:"uint256"}, {type:"bytes32"}, {type:"bytes32"}, {type:"uint256"}],
        [95n, saved!.claimSecretHash, key, 7n]),
    };
    mocks.getTransactionReceipt.mockResolvedValue({ from: portal, logs: [log] });
    const resume = () => resumePendingBridge({
      pending: { ...saved!, l1TxHash: found.hash! }, chainId: 31337, l1RpcUrl: "http://localhost",
    });
    expect((await resume()).credentials).toEqual({
      claimSecret: saved!.claimSecret, claimSecretHash: saved!.claimSecretHash, recipient: "0x01",
      claimAmount: "95", messageHash: key, messageLeafIndex: "7",
    });
    mocks.getTransactionReceipt.mockResolvedValue({ from: portal, logs: [] });
    await expect(resume()).rejects.toThrow("Expected exactly one DepositToAztecPublic");
    expect(mocks.sendCalls).toHaveBeenCalledTimes(mode === "batch" ? 1 : 2);
  });
});
