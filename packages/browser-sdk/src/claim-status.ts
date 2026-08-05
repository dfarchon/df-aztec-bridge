/**
 * Pure claim-status helpers (no Aztec runtime deps) — unit-testable.
 */

export type ClaimMessageStatus = "l2-sync-pending" | "ready" | "consumed";

/** Map PXE witness lookup failures to consumed vs hard error. */
export function classifyWitnessLookupError(error: unknown): "consumed" | "rethrow" {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No non-nullified")) return "consumed";
  return "rethrow";
}

export type L2ReceiptLike = {
  isDropped(): boolean;
  hasExecutionReverted(): boolean;
  status: unknown;
};

/** Validate an L2 claim receipt; keep credentials for retry on revert/drop. */
export function assertL2ClaimReceiptOk(
  receipt: L2ReceiptLike,
  l2TxHash: string,
): { l2TxHash: string; status: string } {
  if (receipt.isDropped()) {
    throw new Error(`L2 claim tx ${l2TxHash} was dropped.`);
  }
  if (receipt.hasExecutionReverted()) {
    throw new Error(`L2 claim tx ${l2TxHash} reverted.`);
  }
  return { l2TxHash, status: String(receipt.status) };
}

/**
 * Prove/submit then notify before wait — ensures callers can persist l2TxHash
 * even if mining is interrupted by a refresh.
 */
export async function sendClaimThenWait<T>(params: {
  send: () => Promise<{ txHash: string }>;
  wait: (l2TxHash: string) => Promise<T>;
  onTxSent?: (l2TxHash: string) => void;
}): Promise<{ l2TxHash: string; waitResult: T }> {
  const { txHash } = await params.send();
  params.onTxSent?.(txHash);
  const waitResult = await params.wait(txHash);
  return { l2TxHash: txHash, waitResult };
}
