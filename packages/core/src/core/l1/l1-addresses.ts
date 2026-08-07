import type { AztecNode } from "@aztec/aztec.js/node";
import { zeroAddress, type Hex } from "viem";

import type { L1Addresses } from "./types.ts";

/** L1 rollup contract addresses from the Aztec node (same as aztec-kit bridge UI). */
export async function fetchL1Addresses(node: AztecNode): Promise<L1Addresses & { l1ChainId: number }> {
  const nodeInfo = await node.getNodeInfo();
  const addrs = nodeInfo.l1ContractAddresses;

  let handlerStr: string | null = null;
  if ("feeAssetHandlerAddress" in addrs) {
    const rawHandler = (addrs as Record<string, unknown>).feeAssetHandlerAddress;
    if (rawHandler && typeof rawHandler === "object" && "toString" in rawHandler) {
      handlerStr = (rawHandler as { toString(): string }).toString();
    } else if (typeof rawHandler === "string") {
      handlerStr = rawHandler;
    }
  }
  const isZero = !handlerStr || handlerStr === zeroAddress;

  return {
    feeJuicePortal: addrs.feeJuicePortalAddress.toString() as Hex,
    feeJuice: addrs.feeJuiceAddress.toString() as Hex,
    feeAssetHandler: isZero ? null : (handlerStr as Hex),
    l1ChainId: nodeInfo.l1ChainId,
  };
}
