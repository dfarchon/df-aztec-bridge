import type { ClaimCredentials } from "@df-bridge/browser-sdk";

/** JSON shape accepted by df-bridge CLI `claim -c`. */
export function claimCredentialsDownloadPayload(
  recipient: string,
  credentials: ClaimCredentials,
  extras?: { l1TxHash?: string; networkId?: string },
) {
  return {
    recipient,
    credentials,
    ...(extras?.l1TxHash ? { l1TxHash: extras.l1TxHash } : {}),
    ...(extras?.networkId ? { networkId: extras.networkId } : {}),
  };
}

export function claimCredentialsFilename(recipient: string, l1TxHash?: string): string {
  const shortRecipient = recipient.replace(/^0x/i, "").slice(0, 10);
  if (l1TxHash) {
    const shortTx = l1TxHash.replace(/^0x/i, "").slice(0, 10);
    return `claim-${shortRecipient}-${shortTx}.json`;
  }
  return `claim-${shortRecipient}.json`;
}

/** Browser has no download-complete event. Hold the blob until the save dialog can start. */
export const DOWNLOAD_HANDOFF_MS = 1_000;

export function downloadJson(filename: string, value: unknown): Promise<void> {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  return new Promise((resolve) => {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve();
    }, DOWNLOAD_HANDOFF_MS);
  });
}

export function downloadClaimCredentials(
  recipient: string,
  credentials: ClaimCredentials,
  opts?: { l1TxHash?: string; networkId?: string },
): Promise<void> {
  return downloadJson(
    claimCredentialsFilename(recipient, opts?.l1TxHash),
    claimCredentialsDownloadPayload(recipient, credentials, opts),
  );
}
