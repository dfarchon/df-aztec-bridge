import type { AztecNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { NetworkConfig } from "../types.js";
import type { ClaimCredentials } from "../types.js";
import { bridgeFeeJuice, pickBridgeRoute } from "../bridging.js";
import { bridgeFeeJuiceViaGoBridge } from "./gobridge.js";
import { fetchL1Addresses } from "./l1-addresses.js";
import { getFeeJuiceBalance } from "./clients.js";

export type L1Backend = "portal" | "gobridge";

export interface L1BridgeParams {
  network: NetworkConfig;
  node: AztecNode;
  recipient: AztecAddress;
  amount: bigint;
  l1PrivateKey: Hex;
  backend: L1Backend;
}

export interface L1BridgeResult {
  credentials: ClaimCredentials;
  l1TxHash?: string;
  backend: L1Backend;
}

/** Single entry for L1 deposit — Portal (Aztec.js) or GoBridge (aztec-kit UI contract). */
export async function bridgeFeeJuiceOnL1(params: L1BridgeParams): Promise<L1BridgeResult> {
  const { network, node, recipient, amount, l1PrivateKey, backend } = params;
  const recipientStr = recipient.toString();

  if (backend === "portal") {
    const bridged = await bridgeFeeJuice({
      node,
      l1RpcUrl: network.l1RpcUrl,
      l1ChainId: network.l1ChainId,
      recipient,
      amount,
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
  });

  return { backend, credentials, l1TxHash };
}
