/**
 * Headless Fee Juice L1 bridge + L1→L2 message wait.
 * Adapted from aztec-kit `packages/common/src/deploy/bridging.ts`.
 */
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import type { AztecNode } from "@aztec/aztec.js/node";
import { createEthereumChain } from "@aztec/ethereum/chain";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { Fr } from "@aztec/foundation/curves/bn254";
import { createLogger } from "@aztec/foundation/log";
import { retryUntil } from "@aztec/foundation/retry";
import { type AztecNodeDebug, createAztecNodeDebugClient } from "@aztec/stdlib/interfaces/client";

import type { Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";

import type { BridgeTimingMode } from "./types.js";

const logger = createLogger("df-bridge:bridging");

const WARP_POLL_INTERVAL_MS = 1000;
const POLL_INTERVAL_MS = 5_000;
const POLL_LOG_INTERVAL_MS = 30_000;

export type FeeJuiceClaim = Awaited<ReturnType<L1FeeJuicePortalManager["bridgeTokensPublic"]>>;

export function pickBridgeRoute(opts: { hasFaucet: boolean; l1Balance: bigint; amount?: bigint }): {
  useFaucet: boolean;
  amount?: bigint;
} {
  const { hasFaucet, l1Balance, amount } = opts;
  if (amount === undefined) {
    if (!hasFaucet) {
      throw new Error(
        "bridgeFeeJuice: `amount` is required when no fee-asset faucet is available.",
      );
    }
    return { useFaucet: true };
  }
  if (l1Balance >= amount) {
    return { useFaucet: false, amount };
  }
  if (hasFaucet) {
    return { useFaucet: true };
  }
  throw new Error(
    `L1 signer holds ${l1Balance} wei of Fee Juice but ${amount} was requested, and no fee-asset faucet is available.`,
  );
}

export interface BridgeFeeJuiceParams {
  node: AztecNode;
  l1RpcUrl: string;
  l1ChainId: number;
  recipient: AztecAddress;
  amount?: bigint;
  l1PrivateKey?: Hex;
}

export async function bridgeFeeJuice(params: BridgeFeeJuiceParams): Promise<FeeJuiceClaim> {
  const { node, l1RpcUrl, l1ChainId, recipient } = params;

  const l1PrivateKey: Hex = params.l1PrivateKey ?? generatePrivateKey();
  const chain = createEthereumChain([l1RpcUrl], l1ChainId);
  const l1Client = createExtendedL1Client(chain.rpcUrls, l1PrivateKey, chain.chainInfo);
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger);

  const tokenManager = portalManager.getTokenManager();
  const route = pickBridgeRoute({
    hasFaucet: tokenManager.handlerAddress !== undefined,
    l1Balance: await tokenManager.getL1TokenBalance(l1Client.account.address),
    amount: params.amount,
  });
  return portalManager.bridgeTokensPublic(recipient, route.amount, route.useFaucet);
}

export interface WaitForClaimParams {
  node: AztecNode;
  messageHash: Fr;
  mode: BridgeTimingMode;
  timeoutMs?: number;
  warpOpts?: { nodeUrl?: string };
}

export async function waitForL1ToL2Message(params: WaitForClaimParams): Promise<void> {
  const { node, messageHash, mode } = params;

  if (mode === "warp") {
    await warpToL1ToL2Message(node, messageHash, {
      ...params.warpOpts,
      timeoutMs: params.timeoutMs ?? 120_000,
    });
    return;
  }

  const timeoutMs = params.timeoutMs ?? 30 * 60_000;
  const startedAt = Date.now();
  let lastLog = startedAt;
  await retryUntil(
    async () => {
      if (await isL1ToL2MessageReady(node, messageHash)) {
        return true;
      }
      if (Date.now() - lastLog > POLL_LOG_INTERVAL_MS) {
        lastLog = Date.now();
        logger.info("Still waiting for L1→L2 message", {
          messageHash: messageHash.toString(),
          elapsedMs: Date.now() - startedAt,
        });
      }
      return undefined;
    },
    `L1→L2 message ${messageHash.toString()}`,
    timeoutMs / 1000,
    POLL_INTERVAL_MS / 1000,
  );
}

async function warpToL1ToL2Message(
  node: AztecNode,
  messageHash: Fr,
  opts: { nodeUrl?: string; timeoutMs?: number } = {},
): Promise<void> {
  const nodeUrl = opts.nodeUrl ?? "http://localhost:8080";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const fullNode =
    typeof (node as Partial<AztecNodeDebug>).warpL2TimeAtLeastBy === "function"
      ? (node as AztecNode & AztecNodeDebug)
      : (Object.assign({}, node, createAztecNodeDebugClient(nodeUrl)) as AztecNode &
          AztecNodeDebug);
  const { slotDuration } = await node.getL1Constants();

  await retryUntil(
    async () => {
      if (await isL1ToL2MessageReady(node, messageHash)) {
        return true;
      }
      await fullNode.warpL2TimeAtLeastBy(slotDuration);
      return undefined;
    },
    `L1→L2 message ${messageHash.toString()} (warping)`,
    timeoutMs / 1000,
    WARP_POLL_INTERVAL_MS / 1000,
  );
}
