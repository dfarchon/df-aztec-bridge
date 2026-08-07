/**
 * Headless GoBridge L1 path — same contract + tx shape as aztec-kit `apps/bridge`.
 * Uses L1 private key + HTTP RPC (no MetaMask).
 */
import type { Hex } from "viem";
import {
  BRIDGE_CONTRACT_ABI,
  getBridgeAddress,
  ZERO_ADDRESS,
  DEFAULT_RESCUE_BENEFICIARY,
  type GoBridgeDeployConfig,
} from "../../vendor/gobridge/deterministic.ts";
import type { ClaimCredentials } from "../types.ts";
import type { L1Addresses } from "./types.ts";
import {
  extractDepositEvent,
  generateClaimSecret,
  getL1ClientsFromPrivateKey,
  toHex64,
  viemReadContract,
  erc20ReadAbi,
  erc20WriteAbi,
  waitForTransactionReceiptWithRetry,
} from "./clients.ts";
import { computeBridgeFee, isValidFeeRecipient } from "../fee.ts";

function aztecRecipientToBytes32(aztecRecipient: string): Hex {
  const raw = aztecRecipient.startsWith("0x") ? aztecRecipient.slice(2) : aztecRecipient;
  return (`0x${raw.padStart(64, "0")}`) as Hex;
}

function bridgeConfigFromAddresses(
  addresses: L1Addresses,
  rescueBeneficiary: Hex,
  feeRecipient: Hex,
): GoBridgeDeployConfig {
  return {
    feeJuice: addresses.feeJuice,
    portal: addresses.feeJuicePortal,
    feeAssetHandler: addresses.feeAssetHandler ?? ZERO_ADDRESS,
    rescueBeneficiary,
    feeRecipient,
  };
}

export async function bridgeFeeJuiceViaGoBridge(params: {
  l1RpcUrl: string;
  chainId: number;
  l1PrivateKey: Hex;
  addresses: L1Addresses;
  aztecRecipient: string;
  amount: bigint;
  mint: boolean;
  feeRecipient: Hex;
  rescueBeneficiary?: Hex;
}): Promise<{ credentials: ClaimCredentials; l1TxHash: Hex }> {
  const { l1RpcUrl, chainId, l1PrivateKey, addresses, aztecRecipient, amount, mint } = params;
  if (!isValidFeeRecipient(params.feeRecipient)) {
    throw new Error("feeRecipient must be a 0x-prefixed 20-byte address");
  }
  const { fee: _fee, net } = computeBridgeFee(amount);
  if (net <= 0n) throw new Error("Bridge amount too small after 5% protocol fee");

  const { publicClient, walletClient, account, accountAddress, chain } = getL1ClientsFromPrivateKey(
    l1RpcUrl,
    chainId,
    l1PrivateKey,
  );

  const secret = await generateClaimSecret();
  const secretHashHex = toHex64(secret.secretHash);
  const recipientHex = aztecRecipientToBytes32(aztecRecipient);
  const config = bridgeConfigFromAddresses(
    addresses,
    params.rescueBeneficiary ?? DEFAULT_RESCUE_BENEFICIARY,
    params.feeRecipient,
  );
  const bridgeAddr = getBridgeAddress(config);

  const bridgeCode = await publicClient.getCode({ address: bridgeAddr });
  if (!bridgeCode || bridgeCode === "0x") {
    throw new Error(
      `GoBridge is not deployed on chain ${chainId} at ${bridgeAddr}. ` +
        `Deploy with: DEPLOYER_KEY=0x… BRIDGE_FEE_RECIPIENT=0x… pnpm deploy-l1-bridge mainnet`,
    );
  }

  let hash: Hex;

  if (mint && addresses.feeAssetHandler) {
    hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "mintAndBridge",
      args: [recipientHex, amount, secretHashHex],
      account,
      chain,
    });
  } else {
    const currentAllowance = (await viemReadContract(publicClient, {
      address: addresses.feeJuice,
      abi: erc20ReadAbi,
      functionName: "allowance",
      args: [accountAddress, bridgeAddr],
    })) as bigint;

    if (currentAllowance < amount) {
      const approveHash = await walletClient.writeContract({
        address: addresses.feeJuice,
        abi: erc20WriteAbi,
        functionName: "approve",
        args: [bridgeAddr, amount],
        account,
        chain,
      });
      await waitForTransactionReceiptWithRetry(publicClient, approveHash);
    }

    hash = await walletClient.writeContract({
      address: bridgeAddr,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: "bridge",
      args: [recipientHex, amount, secretHashHex],
      account,
      chain,
    });
  }

  const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
  const event = extractDepositEvent(receipt, {
    portal: addresses.feeJuicePortal,
    to: recipientHex,
    amount: net,
    secretHash: secretHashHex,
  });

  const credentials: ClaimCredentials = {
    claimSecret: toHex64(secret.secret),
    claimSecretHash: secretHashHex,
    messageHash: event.key,
    messageLeafIndex: event.index.toString(),
    claimAmount: net.toString(),
    recipient: aztecRecipient,
  };

  return { credentials, l1TxHash: hash };
}
