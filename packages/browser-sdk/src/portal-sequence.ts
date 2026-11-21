import { encodeFunctionData, parseAbi, type EIP1193Provider, type Hex } from "viem";
import { aztecRecipientToBytes32, erc20ReadAbi, erc20WriteAbi, getL1Clients, waitForTransactionReceiptWithRetry } from "./clients.ts";
import { computeBridgeFee } from "./fee.ts";
import { isWalletUserRejection } from "./wallet.ts";
import type { BridgeProgressPhase } from "./bridge.ts";
import type { L1Addresses, PreparedDeposit } from "./types.ts";

export const feeJuicePortalAbi = parseAbi([
  "function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) returns (bytes32, uint256)",
]);

type Clients = Awaited<ReturnType<typeof getL1Clients>>;
type Step = "ethFee" | "tokenFee" | "approval" | "deposit";
interface Attempt {
  nonce: number;
  fromBlock: string;
  hash?: Hex;
}

export interface PortalSequencePlan {
  sender: Hex;
  grossAmount: string;
  ethServiceFee: string;
  claimSecretHash: Hex;
}

export interface PortalSequence {
  plan: PortalSequencePlan;
  attempts: Partial<Record<Step, Attempt>>;
}

type Progress = (phase: BridgeProgressPhase, detail: string) => void;
interface Call {
  step: Step;
  to: Hex;
  data: Hex;
  value: bigint;
  label: string;
}

function stepCalls(deposit: Pick<PreparedDeposit, "portal" | "recipient" | "claimSecretHash" | "claimAmount">,
  token: Hex, feeRecipient: Hex, plan: PortalSequencePlan): Call[] {
  const { net, fee } = computeBridgeFee(BigInt(plan.grossAmount));
  if (net <= 0n || net !== BigInt(deposit.claimAmount) || plan.claimSecretHash !== deposit.claimSecretHash) {
    throw new Error("Saved payment details do not match this deposit.");
  }
  const ethFee = BigInt(plan.ethServiceFee);
  const calls: Call[] = [];
  if (ethFee > 0n) calls.push({ step: "ethFee", to: feeRecipient, data: "0x", value: ethFee, label: "ETH service fee" });
  if (fee > 0n) calls.push({ step: "tokenFee", to: token, value: 0n, label: "AZTEC protocol fee",
    data: encodeFunctionData({ abi: erc20WriteAbi, functionName: "transfer", args: [feeRecipient, fee] }) });
  calls.push({ step: "approval", to: token, value: 0n, label: "Fee Juice approval",
    data: encodeFunctionData({ abi: erc20WriteAbi, functionName: "approve", args: [deposit.portal, net] }) });
  calls.push({ step: "deposit", to: deposit.portal, value: 0n, label: "L1 deposit",
    data: encodeFunctionData({ abi: feeJuicePortalAbi, functionName: "depositToAztecPublic",
      args: [aztecRecipientToBytes32(deposit.recipient), net, deposit.claimSecretHash] }) });
  return calls;
}

// A wallet can broadcast before returning its hash. Locate the mined transaction for
// the reserved sender nonce, including a wallet speed-up, without scanning every block.
async function minedAttempt(client: Clients["publicClient"], sender: Hex, attempt: Attempt) {
  if (attempt.hash) {
    try {
      const transaction = await client.getTransaction({ hash: attempt.hash });
      if (transaction.blockNumber !== null) return transaction;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionNotFoundError") throw error;
    }
  }
  let high = await client.getBlockNumber({ cacheTime: 0 });
  if (await client.getTransactionCount({ address: sender, blockNumber: high }) <= attempt.nonce) return null;
  let low = BigInt(attempt.fromBlock);
  while (low < high) {
    const mid = (low + high) / 2n;
    if (await client.getTransactionCount({ address: sender, blockNumber: mid }) > attempt.nonce) high = mid;
    else low = mid + 1n;
  }
  const block = await client.getBlock({ blockNumber: low, includeTransactions: true });
  const tx = block.transactions.find(tx => tx.nonce === attempt.nonce && tx.from.toLowerCase() === sender.toLowerCase());
  if (!tx) throw new Error("Cannot verify the wallet transaction for this step. Check the original Ethereum RPC and retry.");
  return tx;
}

async function confirmedAttempt(client: Clients["publicClient"], account: Hex, call: Call, attempt: Attempt) {
  const mined = await minedAttempt(client, account, attempt);
  if (mined) {
    if (mined.from.toLowerCase() !== account.toLowerCase() || mined.to?.toLowerCase() !== call.to.toLowerCase() ||
        mined.input.toLowerCase() !== call.data.toLowerCase() || mined.value !== call.value) {
      throw new Error(`The wallet transaction differs from the saved ${call.label}. Check the replacement in your wallet before continuing.`);
    }
    const receipt = await client.getTransactionReceipt({ hash: mined.hash });
    return receipt.status === "success" ? { hash: mined.hash } : { reverted: true };
  }
  if (attempt.hash || await client.getTransactionCount({ address: account, blockTag: "pending" }) > attempt.nonce) {
    throw new Error(`The ${call.label} is awaiting confirmation. Check your wallet and resume after it is mined.`);
  }
  // The wallet request may have been interrupted before broadcast. Only reuse its reserved nonce.
  return null;
}

export async function sendPortalSteps(params: {
  clients: Clients;
  deposit: Pick<PreparedDeposit, "portal" | "recipient" | "claimSecretHash" | "claimAmount">;
  token: Hex;
  feeRecipient: Hex;
  sequence: PortalSequence;
  progress: Progress;
  checkpoint?: (sequence: PortalSequence) => Promise<void>;
  guard?: () => void;
}): Promise<Hex> {
  const { publicClient, walletClient, account, chain } = params.clients;
  const { plan } = params.sequence;
  const attempts = { ...params.sequence.attempts };
  const save = async () => { await params.checkpoint?.({ plan, attempts: { ...attempts } }); };
  if (account.toLowerCase() !== plan.sender.toLowerCase()) throw new Error("Reconnect the Ethereum wallet that started this deposit.");
  const calls = stepCalls(params.deposit, params.token, params.feeRecipient, plan);
  const depositCall = calls[calls.length - 1]!;
  // A mined deposit can already have consumed its allowance. Resolve it before asking for any approval.
  if (attempts.deposit) {
    const existing = await confirmedAttempt(publicClient, account, depositCall, attempts.deposit);
    if (existing?.hash) return existing.hash;
    if (existing?.reverted) {
      delete attempts.deposit;
      await save();
    }
  }
  const remaining = attempts.deposit ? [depositCall] : calls;
  for (const call of remaining) {
    params.guard?.();
    let attempt = attempts[call.step];
    if (attempt && call.step !== "deposit") {
      const existing = await confirmedAttempt(publicClient, account, call, attempt);
      if (existing?.hash && call.step !== "approval") continue;
      if (existing) {
        // A mined attempt consumed its nonce. A reverted fee or insufficient allowance needs a new one.
        delete attempts[call.step];
        attempt = undefined;
        await save();
      }
    }
    if (call.step === "approval") {
      const allowance = await publicClient.readContract({ address: params.token, abi: erc20ReadAbi,
        functionName: "allowance", args: [account, params.deposit.portal] });
      if (allowance >= BigInt(params.deposit.claimAmount)) continue;
    }
    if (params.checkpoint && !attempt) {
      const fromBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
      const nonce = await publicClient.getTransactionCount({ address: account, blockTag: "pending" });
      attempt = { nonce, fromBlock: fromBlock.toString() };
      attempts[call.step] = attempt;
      await save();
    }
    params.guard?.();
    params.progress(call.step === "ethFee" ? "eth_fee_wallet" : call.step === "approval" ? "approve_wallet" : "bridge_wallet",
      `Confirm ${call.label} in your wallet`);
    let hash: Hex;
    try {
      // Re-opening an unanswered prompt reuses precisely the same nonce. Only one can mine.
      hash = await walletClient.sendTransaction({ account, chain, to: call.to, data: call.data,
        value: call.value, ...(attempt && { nonce: attempt.nonce }) });
    } catch (error) {
      if (isWalletUserRejection(error) && !params.sequence.attempts[call.step]) {
        delete attempts[call.step];
        await save();
      }
      throw error;
    }
    if (attempt) {
      attempts[call.step] = { ...attempt, hash };
      await save();
    }
    if (call.step === "deposit") return hash;
    params.progress(call.step === "ethFee" ? "eth_fee_wait" : "approve_wait", `Waiting for ${call.label}: ${hash}`);
    const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
    if (attempt && receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
      // Wallet speed-ups and cancellations also consume the nonce. Check the actual call on resume.
      throw new Error(`The wallet replaced the ${call.label} transaction. Open Recover to verify it.`);
    }
    if (receipt.status !== "success") throw new Error(`The ${call.label} reverted. Open Recover to retry this step.`);
  }
  throw new Error("Missing portal deposit step.");
}

export async function resumePortalSequence(params: {
  provider: EIP1193Provider;
  l1RpcUrl: string;
  addresses: L1Addresses;
  feeRecipient: Hex;
  deposit: PreparedDeposit;
  sequence: PortalSequence;
  checkpoint: (state: PortalSequence) => Promise<void>;
  progress: Progress;
  guard: () => void;
}): Promise<Hex> {
  const { deposit, addresses } = params;
  if (addresses.l1ChainId !== deposit.chainId || addresses.feeJuicePortal.toLowerCase() !== deposit.portal.toLowerCase()) {
    throw new Error("Select the original deposit network.");
  }
  const clients = await getL1Clients(params.provider, deposit.chainId, { l1RpcUrl: params.l1RpcUrl });
  if (await clients.publicClient.getChainId() !== deposit.chainId || await clients.walletClient.getChainId() !== deposit.chainId) {
    throw new Error("Switch the Ethereum wallet to the original deposit network.");
  }
  return sendPortalSteps({ ...params, clients, token: addresses.feeJuice });
}
