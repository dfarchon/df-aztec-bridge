import { resumePortalSequence, type BridgeProgressPhase, type ConnectedWallet, type PortalSequence, type PortalSequencePlan } from "@df-bridge/browser-sdk";
import type { Hex } from "viem";
import type { WebNetworkConfig } from "../config/networks.ts";
import { preparedDepositId, type PreparedDepositFile } from "./prepared-deposit.ts";
import { currentVaultGuard, vaultGetJson, vaultSetJson } from "./vault.ts";
import { validateConnectedWalletSession } from "./wallet-session-guard.ts";

// Only a journal created by this browser may initiate new wallet requests. Imported
// prepared-deposit files continue to provide read-only receipt recovery.
export async function continueSequentialDeposit(params: {
  network: WebNetworkConfig;
  wallet: ConnectedWallet;
  feeRecipient: Hex;
  secretHash: Hex;
  initialPlan?: PortalSequencePlan;
  progress: (phase: BridgeProgressPhase, detail: string) => void;
  signal?: AbortSignal;
}) {
  const { network, wallet, secretHash, initialPlan } = params;
  const vaultGuard = currentVaultGuard();
  const guard = () => {
    vaultGuard();
    params.signal?.throwIfAborted();
  };
  const locks = navigator.locks;
  if (!locks) throw new Error("This browser cannot coordinate payment steps across tabs. Open this site in a secure browser.");
  return locks.request(`df-portal-payments:${network.l1ChainId}:${wallet.address.toLowerCase()}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("An Ethereum payment is already in progress in another tab.");
    guard();
    const live = await validateConnectedWalletSession(wallet);
    if (live.chainId !== network.l1ChainId) throw new Error("Switch your wallet to the original Ethereum network to continue.");
    const id = preparedDepositId(secretHash);
    const file = await vaultGetJson<PreparedDepositFile & { sequence?: PortalSequence }>(id);
    guard();
    if (!file || file.networkId !== network.id || file.deposit.claimSecretHash !== secretHash) {
      throw new Error("This preparation is no longer available. Refresh Recover to see its current status.");
    }
    const sequence = file.sequence ?? (initialPlan && { plan: initialPlan, attempts: {} });
    if (!sequence || sequence.plan.sender.toLowerCase() !== live.address.toLowerCase()) {
      throw new Error("Reconnect the Ethereum wallet that started this deposit.");
    }
    async function checkpoint(state: PortalSequence) {
      guard();
      await vaultSetJson(id, { ...file, sequence: state });
      guard();
    }
    if (!file.sequence) await checkpoint(sequence);
    return resumePortalSequence({
      provider: live.provider, addresses: network.l1Addresses, l1RpcUrl: network.l1RpcUrl,
      feeRecipient: params.feeRecipient, deposit: file.deposit, sequence, checkpoint, progress: params.progress, guard,
    });
  });
}
