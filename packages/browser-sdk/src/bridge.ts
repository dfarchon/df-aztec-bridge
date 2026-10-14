import { parseAbi, type EIP1193Provider, type Hex } from "viem";
import { sendCalls, waitForCallsStatus } from "viem/actions";
import {
  BRIDGE_CONTRACT_ABI,
  getBridgeAddress,
  ZERO_ADDRESS,
  DEFAULT_RESCUE_BENEFICIARY,
} from "./vendor/gobridge/deterministic.ts";
import type {
  BridgeFromWalletResult,
  ClaimCredentials,
  L1Addresses,
  PendingBridge,
} from "./types.ts";
import {
  aztecRecipientToBytes32,
  extractDepositEvent,
  generateClaimSecret,
  getL1Clients,
  getL1PublicClient,
  toHex64,
  viemReadContract,
  erc20ReadAbi,
  erc20WriteAbi,
  waitForTransactionReceiptWithRetry,
} from "./clients.ts";
import { computeBridgeFee, isValidFeeRecipient, resolveBridgeEthServiceFee } from "./fee.ts";

export type L1BridgeBackend = "portal" | "gobridge";

export type BridgeProgressPhase =
  | "prepare"
  | "eth_fee_wallet"
  | "eth_fee_wait"
  | "check_allowance"
  | "approve_wallet"
  | "approve_wait"
  | "mint_wallet"
  | "mint_wait"
  | "bridge_wallet"
  | "bridge_wait"
  | "parse_receipt";

const feeJuicePortalAbi = parseAbi([
  "function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) returns (bytes32, uint256)",
]);

const feeAssetHandlerAbi = parseAbi([
  "function mint(address _recipient)",
  "function mintAmount() view returns (uint256)",
]);

function notifyPending(
  callback: ((pending: PendingBridge) => void) | undefined,
  pending: PendingBridge,
) {
  try {
    callback?.(pending);
  } catch (error) {
    // The deposit is already broadcast. Consumer persistence/UI failures must
    // not stop receipt parsing and credential generation.
    console.warn("[bridge] onPending callback failed after broadcast", error);
  }
}

/** One wallet-confirm sentence for the portal batch that is actually being sent. */
export function describePortalBatchConfirm(parts: {
  ethServiceFee: boolean;
  aztecFee: boolean;
  approve: boolean;
}): string {
  const items: string[] = [];
  if (parts.ethServiceFee) items.push("ETH service fee");
  if (parts.aztecFee) items.push("5% AZTEC fee");
  if (parts.approve) items.push("Fee Juice approval");
  items.push("the L1 deposit");
  if (items.length === 1) return "Confirm the L1 deposit in your wallet.";
  if (items.length === 2) return `Confirm in your wallet: ${items[0]} and ${items[1]}.`;
  const last = items[items.length - 1];
  return `Confirm in your wallet: ${items.slice(0, -1).join(", ")}, and ${last}.`;
}

function isSendCallsUnsupported(error: unknown): boolean {
  const err = error as { name?: string; shortMessage?: string; details?: string; message?: string };
  const text = `${err.name ?? ""} ${err.shortMessage ?? ""} ${err.details ?? ""} ${err.message ?? ""}`.toLowerCase();
  return (
    err.name === "MethodNotFoundRpcError" ||
    err.name === "MethodNotSupportedRpcError" ||
    err.name === "AtomicityNotSupportedError" ||
    text.includes("wallet_sendcalls") ||
    text.includes("does not exist / is not available") ||
    text.includes("unsupported method") ||
    text.includes("method not found") ||
    text.includes("forceatomic") ||
    text.includes("atomicity")
  );
}

export async function bridgeFromConnectedWallet(params: {
  provider: EIP1193Provider;
  chainId: number;
  expectedChainId: number;
  addresses: L1Addresses;
  aztecRecipient: string;
  amount: bigint;
  mint: boolean;
  /** Default `portal` — official FeeJuicePortal (no GoBridge deploy). */
  backend?: L1BridgeBackend;
  /** Prefer HTTP RPC for receipt polling (wallet RPC often times out). */
  l1RpcUrl?: string;
  /** L1 fee recipient (Trezor). Required — 5% of gross AZTEC + mainnet ETH service fee. */
  feeRecipient: Hex;
  /**
   * Optional fixed mainnet ETH service fee (wei). When omitted on chainId 1,
   * fee is estimated as gasPrice × ~1 L1 tx gas.
   */
  ethServiceFeeWei?: bigint;
  onProgress?: (phase: BridgeProgressPhase, detail?: string) => void;
  /** Called as soon as the deposit tx is submitted, before waiting for its receipt. */
  onPending?: (pending: PendingBridge) => void;
}): Promise<BridgeFromWalletResult> {
  const backend = params.backend ?? "portal";
  const progress = params.onProgress ?? (() => {});

  if (!isValidFeeRecipient(params.feeRecipient)) {
    throw new Error("feeRecipient must be a 0x-prefixed 20-byte address (set VITE_BRIDGE_FEE_RECIPIENT).");
  }

  if (params.chainId !== params.expectedChainId) {
    throw new Error(
      `Wallet chain ${params.chainId} does not match network (${params.expectedChainId}). Switch network in your wallet.`,
    );
  }

  progress("prepare", `Preparing L1 clients (${backend})`);
  const { publicClient, walletClient, account, chain } = await getL1Clients(
    params.provider,
    params.chainId,
    { l1RpcUrl: params.l1RpcUrl },
  );

  const secret = await generateClaimSecret();
  const secretHashHex = toHex64(secret.secretHash);
  const recipientHex = aztecRecipientToBytes32(params.aztecRecipient);
  const { fee, net } = computeBridgeFee(params.amount);
  if (net <= 0n) {
    throw new Error("Bridge amount too small after 5% protocol fee.");
  }

  // Mainnet ETH service fee (~1 L1 tx) — batched into the portal/gobridge confirm when possible.
  const ethServiceFee = await resolveBridgeEthServiceFee({
    chainId: params.expectedChainId,
    overrideWei: params.ethServiceFeeWei ?? null,
    getMaxFeePerGas: async () => {
      try {
        const fees = await publicClient.estimateFeesPerGas();
        return fees.maxFeePerGas ?? null;
      } catch {
        return null;
      }
    },
    getGasPrice: () => publicClient.getGasPrice(),
  });

  if (backend === "portal") {
    return bridgeViaPortal({
      publicClient,
      walletClient,
      account,
      chain,
      addresses: params.addresses,
      amount: params.amount,
      fee,
      net,
      feeRecipient: params.feeRecipient,
      ethServiceFee,
      mint: params.mint,
      recipientHex,
      secretHashHex,
      claimSecret: toHex64(secret.secret),
      aztecRecipient: params.aztecRecipient,
      progress,
      onPending: params.onPending,
    });
  }

  return bridgeViaGoBridge({
    publicClient,
    walletClient,
    account,
    chain,
    addresses: params.addresses,
    amount: params.amount,
    net,
    ethServiceFee,
    mint: params.mint,
    recipientHex,
    secretHashHex,
    claimSecret: toHex64(secret.secret),
    aztecRecipient: params.aztecRecipient,
    chainId: params.chainId,
    feeRecipient: params.feeRecipient,
    progress,
    onPending: params.onPending,
  });
}

type Clients = Awaited<ReturnType<typeof getL1Clients>>;

type PortalCall =
  | { to: Hex; value: bigint }
  | {
      to: Hex;
      abi: typeof erc20WriteAbi | typeof feeJuicePortalAbi;
      functionName: "transfer" | "approve" | "depositToAztecPublic";
      args: readonly unknown[];
    };

async function tryWalletSendCalls(params: {
  walletClient: Clients["walletClient"];
  account: Clients["account"];
  chain: Clients["chain"];
  calls: PortalCall[];
  forceAtomic: boolean;
}): Promise<Hex | null> {
  try {
    const { id } = await sendCalls(params.walletClient, {
      account: params.account,
      chain: params.chain,
      forceAtomic: params.forceAtomic,
      calls: params.calls,
    });
    return id as Hex;
  } catch (error) {
    if (isSendCallsUnsupported(error)) return null;
    throw error;
  }
}

async function bridgeViaPortal(params: {
  publicClient: Clients["publicClient"];
  walletClient: Clients["walletClient"];
  account: Clients["account"];
  chain: Clients["chain"];
  addresses: L1Addresses;
  amount: bigint;
  fee: bigint;
  net: bigint;
  feeRecipient: Hex;
  ethServiceFee: bigint;
  mint: boolean;
  recipientHex: Hex;
  secretHashHex: Hex;
  claimSecret: Hex;
  aztecRecipient: string;
  progress: (phase: BridgeProgressPhase, detail?: string) => void;
  onPending?: (pending: PendingBridge) => void;
}): Promise<BridgeFromWalletResult> {
  const {
    publicClient,
    walletClient,
    account,
    chain,
    addresses,
    amount,
    fee,
    net,
    feeRecipient,
    ethServiceFee,
    mint,
    recipientHex,
    secretHashHex,
    claimSecret,
    aztecRecipient,
    progress,
    onPending,
  } = params;
  const portal = addresses.feeJuicePortal;
  const token = addresses.feeJuice;

  if (mint && addresses.feeAssetHandler) {
    const mintAmt = (await viemReadContract(publicClient, {
      address: addresses.feeAssetHandler,
      abi: feeAssetHandlerAbi,
      functionName: "mintAmount",
    })) as bigint;
    const mintsNeeded = mintAmt > 0n ? (amount + mintAmt - 1n) / mintAmt : 1n;
    for (let i = 0n; i < mintsNeeded; i += 1n) {
      progress("mint_wallet", `Confirm faucet mint ${i + 1n}/${mintsNeeded} in wallet`);
      const mintHash = await walletClient.writeContract({
        address: addresses.feeAssetHandler,
        abi: feeAssetHandlerAbi,
        functionName: "mint",
        args: [account],
        account,
        chain,
      });
      progress("mint_wait", `Waiting for mint tx ${mintHash}`);
      await waitForTransactionReceiptWithRetry(publicClient, mintHash);
    }
  }

  progress("check_allowance", "Checking ERC20 allowance for FeeJuicePortal");
  const currentAllowance = (await viemReadContract(publicClient, {
    address: token,
    abi: erc20ReadAbi,
    functionName: "allowance",
    args: [account, portal],
  })) as bigint;
  const needsApprove = currentAllowance < net;

  const batchCalls: PortalCall[] = [];
  if (ethServiceFee > 0n) {
    batchCalls.push({ to: feeRecipient, value: ethServiceFee });
  }
  if (fee > 0n) {
    batchCalls.push({
      to: token,
      abi: erc20WriteAbi,
      functionName: "transfer",
      args: [feeRecipient, fee],
    });
  }
  if (needsApprove) {
    batchCalls.push({
      to: token,
      abi: erc20WriteAbi,
      functionName: "approve",
      args: [portal, net],
    });
  }
  batchCalls.push({
    to: portal,
    abi: feeJuicePortalAbi,
    functionName: "depositToAztecPublic",
    args: [recipientHex, net, secretHashHex],
  });

  // Prefer one wallet confirm for the calls that are actually in this batch (EIP-5792).
  let hash: Hex | null = null;
  if (batchCalls.length > 1) {
    progress(
      ethServiceFee > 0n ? "eth_fee_wallet" : "bridge_wallet",
      describePortalBatchConfirm({
        ethServiceFee: ethServiceFee > 0n,
        aztecFee: fee > 0n,
        approve: needsApprove,
      }),
    );
    let bundleId =
      (await tryWalletSendCalls({
        walletClient,
        account,
        chain,
        calls: batchCalls,
        forceAtomic: true,
      })) ??
      (await tryWalletSendCalls({
        walletClient,
        account,
        chain,
        calls: batchCalls,
        forceAtomic: false,
      }));

    if (bundleId) {
      progress("bridge_wait", `Waiting for batched bridge ${bundleId}`);
      const status = await waitForCallsStatus(walletClient, {
        id: bundleId,
        timeout: 600_000,
        throwOnFailure: true,
      });
      const receipts = status.receipts ?? [];
      const depositReceipt = receipts[receipts.length - 1];
      const depositHash = depositReceipt?.transactionHash as Hex | undefined;
      if (!depositHash) {
        throw new Error("Batched bridge completed without a deposit transaction hash.");
      }
      hash = depositHash;
      notifyPending(onPending, {
        l1TxHash: hash,
        claimSecret,
        claimSecretHash: secretHashHex,
        claimAmount: net.toString(),
        recipient: aztecRecipient,
        portal,
      });
      const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
      progress("parse_receipt", "Parsing DepositToAztecPublic event");
      const event = extractDepositEvent(receipt, {
        portal,
        to: recipientHex,
        amount: net,
        secretHash: secretHashHex,
      });
      const credentials: ClaimCredentials = {
        claimSecret,
        claimSecretHash: secretHashHex,
        messageHash: event.key,
        messageLeafIndex: event.index.toString(),
        claimAmount: net.toString(),
        recipient: aztecRecipient,
      };
      return { l1TxHash: hash, credentials, sender: account };
    }
  }

  // Fallback: sequential confirms (wallets without EIP-5792).
  if (ethServiceFee > 0n) {
    progress(
      "eth_fee_wallet",
      `Confirm mainnet ETH service fee (~1 L1 tx) → treasury (${ethServiceFee} wei)`,
    );
    const ethHash = await walletClient.sendTransaction({
      account,
      chain,
      to: feeRecipient,
      value: ethServiceFee,
    });
    progress("eth_fee_wait", `Waiting for ETH fee tx ${ethHash}`);
    await waitForTransactionReceiptWithRetry(publicClient, ethHash);
  }

  if (fee > 0n) {
    progress("bridge_wallet", "Confirm 5% protocol fee transfer");
    const feeHash = await walletClient.writeContract({
      address: token,
      abi: erc20WriteAbi,
      functionName: "transfer",
      args: [feeRecipient, fee],
      account,
      chain,
    });
    progress("approve_wait", `Waiting for fee tx ${feeHash}`);
    await waitForTransactionReceiptWithRetry(publicClient, feeHash);
  }

  if (needsApprove) {
    progress("approve_wallet", "Confirm token approve (portal) in wallet");
    const approveHash = await walletClient.writeContract({
      address: token,
      abi: erc20WriteAbi,
      functionName: "approve",
      args: [portal, net],
      account,
      chain,
    });
    progress("approve_wait", `Waiting for approve tx ${approveHash}`);
    await waitForTransactionReceiptWithRetry(publicClient, approveHash);
  }

  progress("bridge_wallet", "Confirm depositToAztecPublic in wallet");
  hash = await walletClient.writeContract({
    address: portal,
    abi: feeJuicePortalAbi,
    functionName: "depositToAztecPublic",
    args: [recipientHex, net, secretHashHex],
    account,
    chain,
  });

  notifyPending(onPending, {
    l1TxHash: hash,
    claimSecret,
    claimSecretHash: secretHashHex,
    claimAmount: net.toString(),
    recipient: aztecRecipient,
    portal,
  });
  progress("bridge_wait", `Waiting for portal tx ${hash}`);
  const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
  progress("parse_receipt", "Parsing DepositToAztecPublic event");
  const event = extractDepositEvent(receipt, {
    portal,
    to: recipientHex,
    amount: net,
    secretHash: secretHashHex,
  });

  const credentials: ClaimCredentials = {
    claimSecret,
    claimSecretHash: secretHashHex,
    messageHash: event.key,
    messageLeafIndex: event.index.toString(),
    claimAmount: net.toString(),
    recipient: aztecRecipient,
  };

  return { l1TxHash: hash, credentials, sender: account };
}

async function bridgeViaGoBridge(params: {
  publicClient: Clients["publicClient"];
  walletClient: Clients["walletClient"];
  account: Clients["account"];
  chain: Clients["chain"];
  addresses: L1Addresses;
  amount: bigint;
  net: bigint;
  ethServiceFee: bigint;
  mint: boolean;
  recipientHex: Hex;
  secretHashHex: Hex;
  claimSecret: Hex;
  aztecRecipient: string;
  chainId: number;
  feeRecipient: Hex;
  progress: (phase: BridgeProgressPhase, detail?: string) => void;
  onPending?: (pending: PendingBridge) => void;
}): Promise<BridgeFromWalletResult> {
  const {
    publicClient,
    walletClient,
    account,
    chain,
    addresses,
    amount,
    net,
    ethServiceFee,
    mint,
    recipientHex,
    secretHashHex,
    claimSecret,
    aztecRecipient,
    chainId,
    feeRecipient,
    progress,
    onPending,
  } = params;
  const bridgeAddr = getBridgeAddress({
    feeJuice: addresses.feeJuice,
    portal: addresses.feeJuicePortal,
    feeAssetHandler: addresses.feeAssetHandler ?? ZERO_ADDRESS,
    rescueBeneficiary: DEFAULT_RESCUE_BENEFICIARY,
    feeRecipient,
  });

  const bridgeCode = await publicClient.getCode({ address: bridgeAddr });
  if (!bridgeCode || bridgeCode === "0x") {
    throw new Error(
      `GoBridge is not deployed on chain ${chainId} at ${bridgeAddr}. ` +
        `Deploy it first: DEPLOYER_KEY=0x… pnpm deploy-l1-bridge mainnet ` +
        `(or switch L1 backend to portal).`,
    );
  }

  let hash: Hex;

  if (mint && addresses.feeAssetHandler) {
    progress(
      ethServiceFee > 0n ? "eth_fee_wallet" : "bridge_wallet",
      ethServiceFee > 0n
        ? "Confirm mintAndBridge + ETH service fee in your wallet"
        : "Confirm mintAndBridge in your wallet",
    );
    hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "mintAndBridge",
      args: [recipientHex, amount, secretHashHex],
      account,
      chain,
      value: ethServiceFee > 0n ? ethServiceFee : undefined,
    });
  } else {
    progress("check_allowance", "Checking ERC20 allowance");
    const currentAllowance = (await viemReadContract(publicClient, {
      address: addresses.feeJuice,
      abi: erc20ReadAbi,
      functionName: "allowance",
      args: [account, bridgeAddr],
    })) as bigint;

    if (currentAllowance < amount) {
      progress("approve_wallet", "Confirm token approve in your wallet");
      const approveHash = await walletClient.writeContract({
        address: addresses.feeJuice,
        abi: erc20WriteAbi,
        functionName: "approve",
        args: [bridgeAddr, amount],
        account,
        chain,
      });
      progress("approve_wait", `Waiting for approve tx ${approveHash}`);
      await waitForTransactionReceiptWithRetry(publicClient, approveHash);
    }

    progress(
      ethServiceFee > 0n ? "eth_fee_wallet" : "bridge_wallet",
      ethServiceFee > 0n
        ? "Confirm bridge + ETH service fee (AZTEC fee skimmed onchain) in your wallet"
        : "Approve done. Confirm bridge tx in your wallet",
    );
    hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "bridge",
      args: [recipientHex, amount, secretHashHex],
      account,
      chain,
      value: ethServiceFee > 0n ? ethServiceFee : undefined,
    });
  }

  notifyPending(onPending, {
    l1TxHash: hash,
    claimSecret,
    claimSecretHash: secretHashHex,
    claimAmount: net.toString(),
    recipient: aztecRecipient,
    portal: addresses.feeJuicePortal,
  });
  progress("bridge_wait", `Waiting for bridge tx ${hash}`);
  const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
  progress("parse_receipt", "Parsing DepositToAztecPublic event");
  const event = extractDepositEvent(receipt, {
    portal: addresses.feeJuicePortal,
    to: recipientHex,
    amount: net,
    secretHash: secretHashHex,
  });

  const credentials: ClaimCredentials = {
    claimSecret,
    claimSecretHash: secretHashHex,
    messageHash: event.key,
    messageLeafIndex: event.index.toString(),
    claimAmount: net.toString(),
    recipient: aztecRecipient,
  };

  return { l1TxHash: hash, credentials, sender: account };
}

/**
 * Resume a submitted bridge after a refresh by waiting for its L1 receipt and
 * deriving the complete claim credentials from the deposit event.
 */
export async function resumePendingBridge(params: {
  pending: PendingBridge;
  chainId: number;
  l1RpcUrl: string;
  provider?: EIP1193Provider | null;
}): Promise<BridgeFromWalletResult> {
  if (!params.pending.portal) {
    throw new Error("Pending bridge is missing portal address; cannot safely resume");
  }
  const publicClient = getL1PublicClient(params.l1RpcUrl, params.chainId, params.provider);
  const receipt = await waitForTransactionReceiptWithRetry(
    publicClient,
    params.pending.l1TxHash,
  );
  const recipientHex = aztecRecipientToBytes32(params.pending.recipient);
  const event = extractDepositEvent(receipt, {
    portal: params.pending.portal!,
    to: recipientHex,
    amount: BigInt(params.pending.claimAmount),
    secretHash: params.pending.claimSecretHash,
  });

  const credentials: ClaimCredentials = {
    claimSecret: params.pending.claimSecret,
    claimSecretHash: params.pending.claimSecretHash,
    messageHash: event.key,
    messageLeafIndex: event.index.toString(),
    claimAmount: params.pending.claimAmount,
    recipient: params.pending.recipient,
  };

  return {
    l1TxHash: params.pending.l1TxHash,
    credentials,
    sender: receipt.from,
  };
}
