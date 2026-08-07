import type { AztecNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { NetworkConfig } from "../types.ts";
import type { ClaimCredentials } from "../types.ts";
import { bridgeFeeJuice, pickBridgeRoute } from "../bridging.ts";
import { bridgeFeeJuiceViaGoBridge } from "./gobridge.ts";
import { fetchL1Addresses } from "./l1-addresses.ts";
import {
  erc20WriteAbi,
  getFeeJuiceBalance,
  getL1ClientsFromPrivateKey,
  waitForTransactionReceiptWithRetry,
} from "./clients.ts";
import { computeBridgeFee, isValidFeeRecipient } from "../fee.ts";

export type L1Backend = "portal" | "gobridge";

export interface L1BridgeParams {
  network: NetworkConfig;
  node: AztecNode;
  recipient: AztecAddress;
  amount: bigint;
  l1PrivateKey: Hex;
  backend: L1Backend;
  /** Defaults to process.env.BRIDGE_FEE_RECIPIENT */
  feeRecipient?: Hex;
}

export interface L1BridgeResult {
  credentials: ClaimCredentials;
  l1TxHash?: string;
  backend: L1Backend;
}

function resolveFeeRecipient(explicit?: Hex): Hex {
  const fromEnv = (explicit ?? process.env.BRIDGE_FEE_RECIPIENT) as Hex | undefined;
  if (!isValidFeeRecipient(fromEnv)) {
    throw new Error("BRIDGE_FEE_RECIPIENT must be set to a 0x-prefixed 20-byte address");
  }
  return fromEnv;
}

/** Single entry for L1 deposit — Portal (Aztec.js) or GoBridge (aztec-kit UI contract). */
export async function bridgeFeeJuiceOnL1(params: L1BridgeParams): Promise<L1BridgeResult> {
  const { network, node, recipient, amount, l1PrivateKey, backend } = params;
  const recipientStr = recipient.toString();
  const feeRecipient = resolveFeeRecipient(params.feeRecipient);
  const { fee, net } = computeBridgeFee(amount);
  if (net <= 0n) throw new Error("Bridge amount too small after 5% protocol fee");

  if (backend === "portal") {
    if (fee > 0n) {
      const { publicClient, walletClient, account, chain } = getL1ClientsFromPrivateKey(
        network.l1RpcUrl,
        network.l1ChainId,
        l1PrivateKey,
      );
      const addresses = await fetchL1Addresses(node);
      const feeHash = await walletClient.writeContract({
        address: addresses.feeJuice,
        abi: erc20WriteAbi,
        functionName: "transfer",
        args: [feeRecipient, fee],
        account,
        chain,
      });
      await waitForTransactionReceiptWithRetry(publicClient, feeHash);
    }

    const bridged = await bridgeFeeJuice({
      node,
      l1RpcUrl: network.l1RpcUrl,
      l1ChainId: network.l1ChainId,
      recipient,
      amount: net,
      l1PrivateKey,
    });
    return {
      backend,
      credentials: {
        claimSecret: bridged.claimSecret.toString(),
        claimSecretHash: "",
        messageHash: String(bridged.messageHash),
        messageLeafIndex: bridged.messageLeafIndex.toString(),
        claimAmount: bridged.claimAmount.toString(),
        recipient: recipientStr,
      },
    };
  }

  const addresses = await fetchL1Addresses(node);
  if (addresses.l1ChainId !== network.l1ChainId) {
    throw new Error(
      `Network l1ChainId ${network.l1ChainId} does not match node (${addresses.l1ChainId}).`,
    );
  }

  const { balance } = await getFeeJuiceBalance(
    network.l1RpcUrl,
    network.l1ChainId,
    addresses.feeJuice,
    privateKeyToAccount(l1PrivateKey).address,
  );

  const route = pickBridgeRoute({
    hasFaucet: addresses.feeAssetHandler !== null,
    l1Balance: balance,
    amount,
  });

  const { credentials, l1TxHash } = await bridgeFeeJuiceViaGoBridge({
    l1RpcUrl: network.l1RpcUrl,
    chainId: network.l1ChainId,
    l1PrivateKey,
    addresses,
    aztecRecipient: recipientStr,
    amount: route.amount ?? amount,
    mint: route.useFaucet,
    feeRecipient,
  });

  return { backend, credentials, l1TxHash };
}
