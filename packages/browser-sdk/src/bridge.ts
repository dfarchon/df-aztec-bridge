import { parseAbi, type EIP1193Provider, type Hex } from "viem";
import { BRIDGE_CONTRACT_ABI, getBridgeAddress } from "./vendor/gobridge/deterministic.js";
import type {
  BridgeFromWalletResult,
  ClaimCredentials,
  L1Addresses,
  PendingBridge,
} from "./types.js";
import {
  aztecRecipientToBytes32,
  extractAllDepositEvents,
  generateClaimSecret,
  getL1Clients,
  getL1PublicClient,
  toHex64,
  viemReadContract,
  erc20ReadAbi,
  erc20WriteAbi,
  waitForTransactionReceiptWithRetry,
} from "./clients.js";

export type L1BridgeBackend = "portal" | "gobridge";

export type BridgeProgressPhase =
  | "prepare"
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
  onProgress?: (phase: BridgeProgressPhase, detail?: string) => void;
  /** Called as soon as the deposit tx is submitted, before waiting for its receipt. */
  onPending?: (pending: PendingBridge) => void;
}): Promise<BridgeFromWalletResult> {
  const backend = params.backend ?? "portal";
  const progress = params.onProgress ?? (() => {});

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

  if (backend === "portal") {
    return bridgeViaPortal({
      publicClient,
      walletClient,
      account,
      chain,
      addresses: params.addresses,
      amount: params.amount,
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
    mint: params.mint,
    recipientHex,
    secretHashHex,
    claimSecret: toHex64(secret.secret),
    aztecRecipient: params.aztecRecipient,
    chainId: params.chainId,
    progress,
    onPending: params.onPending,
  });
}

type Clients = Awaited<ReturnType<typeof getL1Clients>>;

async function bridgeViaPortal(params: {
  publicClient: Clients["publicClient"];
  walletClient: Clients["walletClient"];
  account: Clients["account"];
  chain: Clients["chain"];
  addresses: L1Addresses;
  amount: bigint;
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

  if (currentAllowance < amount) {
    progress("approve_wallet", "Confirm token approve (portal) in wallet");
    const approveHash = await walletClient.writeContract({
      address: token,
      abi: erc20WriteAbi,
      functionName: "approve",
      args: [portal, amount],
      account,
      chain,
    });
    progress("approve_wait", `Waiting for approve tx ${approveHash}`);
    await waitForTransactionReceiptWithRetry(publicClient, approveHash);
  }

  progress("bridge_wallet", "Confirm depositToAztecPublic in wallet");
  const hash = await walletClient.writeContract({
    address: portal,
    abi: feeJuicePortalAbi,
    functionName: "depositToAztecPublic",
    args: [recipientHex, amount, secretHashHex],
    account,
    chain,
  });

  notifyPending(onPending, {
    l1TxHash: hash,
    claimSecret,
    claimSecretHash: secretHashHex,
    claimAmount: amount.toString(),
    recipient: aztecRecipient,
  });
  progress("bridge_wait", `Waiting for portal tx ${hash}`);
  const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
  progress("parse_receipt", "Parsing DepositToAztecPublic event");
  const events = extractAllDepositEvents(receipt);
  if (events.length < 1) {
    throw new Error(`Portal: expected DepositToAztecPublic event at ${portal}`);
  }

  const credentials: ClaimCredentials = {
    claimSecret,
    claimSecretHash: secretHashHex,
    messageHash: events[0].key,
    messageLeafIndex: events[0].index.toString(),
    claimAmount: amount.toString(),
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
  mint: boolean;
  recipientHex: Hex;
  secretHashHex: Hex;
  claimSecret: Hex;
  aztecRecipient: string;
  chainId: number;
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
    mint,
    recipientHex,
    secretHashHex,
    claimSecret,
    aztecRecipient,
    chainId,
    progress,
    onPending,
  } = params;
  const bridgeAddr = getBridgeAddress();

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
    progress("bridge_wallet", "Confirm mintAndBridge in your wallet");
    hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "mintAndBridge",
      args: [
        addresses.feeAssetHandler,
        addresses.feeJuice,
        addresses.feeJuicePortal,
        recipientHex,
        amount,
        secretHashHex,
      ],
      account,
      chain,
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

    progress("bridge_wallet", "Approve done — confirm bridge tx in your wallet");
    hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "bridge",
      args: [
        addresses.feeJuice,
        addresses.feeJuicePortal,
        recipientHex,
        amount,
        secretHashHex,
      ],
      account,
      chain,
    });
  }

  notifyPending(onPending, {
    l1TxHash: hash,
    claimSecret,
    claimSecretHash: secretHashHex,
    claimAmount: amount.toString(),
    recipient: aztecRecipient,
  });
  progress("bridge_wait", `Waiting for bridge tx ${hash}`);
  const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
  progress("parse_receipt", "Parsing DepositToAztecPublic event");
  const events = extractAllDepositEvents(receipt);
  if (events.length < 1) {
    throw new Error(`GoBridge: expected DepositToAztecPublic event at ${bridgeAddr}`);
  }

  const credentials: ClaimCredentials = {
    claimSecret,
    claimSecretHash: secretHashHex,
    messageHash: events[0].key,
    messageLeafIndex: events[0].index.toString(),
    claimAmount: amount.toString(),
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
  const publicClient = getL1PublicClient(params.l1RpcUrl, params.chainId, params.provider);
  const receipt = await waitForTransactionReceiptWithRetry(
    publicClient,
    params.pending.l1TxHash,
  );
  const events = extractAllDepositEvents(receipt);
  if (events.length < 1) {
    throw new Error("Pending bridge: expected a DepositToAztecPublic event");
  }

  const credentials: ClaimCredentials = {
    claimSecret: params.pending.claimSecret,
    claimSecretHash: params.pending.claimSecretHash,
    messageHash: events[0].key,
    messageLeafIndex: events[0].index.toString(),
    claimAmount: params.pending.claimAmount,
    recipient: params.pending.recipient,
  };

  return {
    l1TxHash: params.pending.l1TxHash,
    credentials,
    sender: receipt.from,
  };
}
