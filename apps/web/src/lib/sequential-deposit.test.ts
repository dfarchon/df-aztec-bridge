import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumePortalSequence, type ConnectedWallet, type PortalSequencePlan } from "@df-bridge/browser-sdk";
import type { Hex } from "viem";
import { getNetwork } from "../config/networks.ts";
import { listPreparedDeposits, parsePreparedDeposit, savePreparedDeposit } from "./prepared-deposit.ts";
import { continueSequentialDeposit } from "./sequential-deposit.ts";
import { lockVault, resetVaultSession, setVaultBackend, setupVault, unlockVault } from "./vault.ts";
import { createMemoryVaultBackend } from "./vault-idb.ts";

vi.mock("@df-bridge/browser-sdk", async importOriginal => ({
  ...await importOriginal<typeof import("@df-bridge/browser-sdk")>(), resumePortalSequence: vi.fn(),
}));

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const secretHash = ("0x" + "ab".repeat(32)) as Hex;
const network = getNetwork("mainnet");
const password = "test-sequence-password";
const wallet = { address: sender, chainId: 1, rdns: "com.example.wallet", provider: {
  request: async ({ method }: { method: string }) => method === "eth_chainId" ? "0x1" : [sender],
} } as ConnectedWallet;
const params = { network, wallet, feeRecipient: sender as Hex, secretHash, progress: vi.fn() };
const initialPlan: PortalSequencePlan = { sender, grossAmount: "100", ethServiceFee: "9", claimSecretHash: secretHash };
const deposit = { chainId: 1, portal: network.l1Addresses.feeJuicePortal, fromBlock: "10", recipient,
  claimAmount: "95", claimSecretHash: secretHash, claimSecret: ("0x" + "cd".repeat(32)) as Hex };

describe("vault-backed L1 payment continuation", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, run: (lock: object) => Promise<unknown>) => run({}) } });
    vi.stubGlobal("localStorage", { length: 0, getItem: () => null, removeItem: () => {} });
    setVaultBackend(createMemoryVaultBackend());
    await setupVault({ aztecAddress: recipient, password });
    await savePreparedDeposit(network.id, deposit);
  });
  afterEach(() => { resetVaultSession(); vi.unstubAllGlobals(); });

  it("reloads the last checkpoint after relocking and keeps plain JSON imports read-only", async () => {
    await expect(continueSequentialDeposit(params)).rejects.toThrow();
    expect(resumePortalSequence).not.toHaveBeenCalled();
    vi.mocked(resumePortalSequence).mockImplementationOnce(async ({ sequence, checkpoint }) => {
      await checkpoint({ ...sequence, attempts: { ethFee: { nonce: 7, fromBlock: "12" } } });
      throw new Error("tab closed");
    });
    await expect(continueSequentialDeposit({ ...params, initialPlan })).rejects.toThrow("tab closed");
    lockVault();
    await unlockVault({ aztecAddress: recipient, password });
    const [file] = await listPreparedDeposits(network.id);
    expect(file).toMatchObject({ paymentSender: sender, grossAmount: "100" });
    expect(parsePreparedDeposit(file)).toEqual({ format: "df-bridge-prepared-deposit-v1", networkId: network.id, deposit });
    vi.mocked(resumePortalSequence).mockImplementationOnce(async ({ sequence }) => {
      expect(sequence).toEqual({ plan: initialPlan, attempts: { ethFee: { nonce: 7, fromBlock: "12" } } });
      return secretHash;
    });
    await expect(continueSequentialDeposit(params)).resolves.toBe(secretHash);
  });

  it("makes no spending request if a second tab holds the payment lock", async () => {
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, run: (lock: null) => Promise<unknown>) => run(null) } });
    await expect(continueSequentialDeposit({ ...params, initialPlan })).rejects.toThrow("another tab");
    expect(resumePortalSequence).not.toHaveBeenCalled();
  });
});
