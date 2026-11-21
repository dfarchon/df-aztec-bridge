import type { ImportedAztecAccount } from "./account-import.ts";
import type { BridgeSessionEntry } from "./bridge-session.ts";

import type { PreparedDepositFile } from "./prepared-deposit.ts";

export type ExportableClaim =
  | (Pick<BridgeSessionEntry, "networkId" | "l1TxHash" | "credentials" | "pending"> & { prepared?: never })
  | { networkId: string; prepared: PreparedDepositFile; l1TxHash?: never; credentials?: never; pending?: never };

export function exportableClaimId(claim: ExportableClaim) {
  return claim.networkId + ":" + (claim.prepared ? "deposit:" + claim.prepared.deposit.claimSecretHash : claim.l1TxHash.toLowerCase());
}

export async function accountClaimKey(address: string, account?: Partial<ImportedAztecAccount>): Promise<CryptoKey | null> {
  if (account?.address?.toLowerCase() !== address.toLowerCase()) return null;
  const hex = account.secretKey?.replace(/^0x/i, "");
  if (!hex || !/^[a-f0-9]{1,64}$/i.test(hex) || /^0+$/.test(hex)) return null;
  const bytes = Uint8Array.from(hex.padStart(64, "0").match(/../g)!, pair => parseInt(pair, 16));
  const material = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  bytes.fill(0);
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: encoder.encode(address.toLowerCase()),
    info: encoder.encode("df-bridge/account-json/claims-only/v1"),
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
