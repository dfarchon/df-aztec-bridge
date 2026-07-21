/**
 * Headless GoBridge L1 path — same contract + tx shape as aztec-kit `apps/bridge`.
 * Uses L1 private key + HTTP RPC (no MetaMask).
 */
import type { Hex } from "viem";
import { BRIDGE_CONTRACT_ABI, getBridgeAddress } from "../../vendor/gobridge/deterministic.js";
import type { ClaimCredentials } from "../types.js";
import type { L1Addresses } from "./types.js";
import {
  extractAllDepositEvents,
  generateClaimSecret,
  getL1ClientsFromPrivateKey,
  toHex64,
  viemReadContract,
  erc20ReadAbi,
  erc20WriteAbi,
  waitForTransactionReceiptWithRetry,
} from "./clients.js";

function aztecRecipientToBytes32(aztecRecipient: string): Hex {
  const raw = aztecRecipient.startsWith("0x") ? aztecRecipient.slice(2) : aztecRecipient;
  return (`0x${raw.padStart(64, "0")}`) as Hex;
}

export async function bridgeFeeJuiceViaGoBridge(params: {
  l1RpcUrl: string;
  chainId: number;
  l1PrivateKey: Hex;
  addresses: L1Addresses;
  aztecRecipient: string;
  amount: bigint;
  mint: boolean;
}): Promise<{ credentials: ClaimCredentials; l1TxHash: Hex }> {
  const { l1RpcUrl, chainId, l1PrivateKey, addresses, aztecRecipient, amount, mint } = params;
  const { publicClient, walletClient, account, accountAddress, chain } = getL1ClientsFromPrivateKey(
    l1RpcUrl,
    chainId,
    l1PrivateKey,
  );

  const secret = await generateClaimSecret();
  const secretHashHex = toHex64(secret.secretHash);
  const recipientHex = aztecRecipientToBytes32(aztecRecipient);
  const bridgeAddr = getBridgeAddress();

  const bridgeCode = await publicClient.getCode({ address: bridgeAddr });
  if (!bridgeCode || bridgeCode === "0x") {
    throw new Error(
      `GoBridge is not deployed on chain ${chainId} at ${bridgeAddr}. ` +
        `Deploy with: DEPLOYER_KEY=0x… pnpm deploy-l1-bridge mainnet`,
    );
  }

  let hash: Hex;

  if (mint && addresses.feeAssetHandler) {
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

  const receipt = await waitForTransactionReceiptWithRetry(publicClient, hash);
  const events = extractAllDepositEvents(receipt);
  if (events.length < 1) {
    throw new Error(
      `GoBridge: expected DepositToAztecPublic event; is GoBridge deployed at ${bridgeAddr}? Run pnpm deploy-l1-bridge`,
    );
  }

  const credentials: ClaimCredentials = {
    claimSecret: toHex64(secret.secret),
    claimSecretHash: secretHashHex,
    messageHash: events[0].key,
    messageLeafIndex: events[0].index.toString(),
    claimAmount: amount.toString(),
    recipient: aztecRecipient,
  };

  return { credentials, l1TxHash: hash };
}
