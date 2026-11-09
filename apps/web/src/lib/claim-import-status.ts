import { shortHash } from "./claim-recovery.ts";
import type { ClaimCredentials } from "@df-bridge/browser-sdk";

export type ImportedClaimStatus = "consumed" | "ready" | "l2-sync-pending" | "unavailable";

export async function checkImportedClaimStatus(aztecNodeUrl: string | undefined, credentials: ClaimCredentials): Promise<ImportedClaimStatus> {
  if (!aztecNodeUrl) return "unavailable";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
    const { getClaimMessageStatus } = await loadBrowserClaim();
    return await Promise.race([
      getClaimMessageStatus({ aztecNodeUrl, credentials }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Claim status check timed out")), 15_000); }),
    ]);
  } catch {
    return "unavailable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Decide what can be concluded from a read-only node check before saving a claim. */
export function describeClaimImport(status: ImportedClaimStatus, duplicate: boolean, l1TxHash: string): {
  shouldSave: boolean;
  message: string;
} {
  const id = shortHash(l1TxHash);
  if (status === "consumed") {
    return {
      shouldSave: false,
      message: `L1 ${id}: the claim message was already consumed on Aztec. No new claim was submitted.${duplicate ? " The existing local record was kept." : ""}`,
    };
  }
  const statusText = status === "ready"
    ? "The Aztec message is available to claim."
    : status === "l2-sync-pending"
      ? "The message is not yet available on Aztec; its claim status cannot be confirmed."
      : "Could not check the Aztec claim status. Try again when the node is available.";
  return {
    shouldSave: !duplicate,
    message: duplicate
      ? `L1 ${id} is already saved in this browser. ${statusText}`
      : `Imported L1 ${id}. ${statusText}`,
  };
}
