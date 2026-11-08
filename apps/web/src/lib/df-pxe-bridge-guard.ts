/**
 * Bridge may only run against a DF Punk account that was registered into PXE
 * under a live, trusted Web3 connector session.
 */

import type { ImportedAztecAccount } from "./account-import.ts";
import { assertDfClientAccount } from "./account-import.ts";

function isBoundAztecAddress(
  account: ImportedAztecAccount,
  ethAddress: string,
): boolean {
  if (!account.boundEthAddress) return false;
  if (account.boundEthAddress.toLowerCase() !== ethAddress.toLowerCase()) return false;
  return /^0x[0-9a-fA-F]{64}$/i.test(account.address);
}

/**
 * Session is viewable in the bridge shell (including pre-v6 wallets that must warn).
 * Does not mean L2 claim/PXE is ready.
 */
export function isInspectableDfAccount(
  account: ImportedAztecAccount | null | undefined,
  ethAddress: string | null | undefined,
): boolean {
  if (!account || !ethAddress) return false;
  if (!isBoundAztecAddress(account, ethAddress)) return false;
  if (account.connector === "nulo") return true;
  if (!account.fromDfClient) return false;
  return !!account.signingKey?.trim() || account.walletCompat === "pre-v6";
}

export function isBridgeReadyDfPxeAccount(
  account: ImportedAztecAccount | null | undefined,
  ethAddress: string | null | undefined,
): account is ImportedAztecAccount {
  if (!account || !ethAddress) return false;
  if (account.walletCompat === "pre-v6") return false;
  if (account.connector === "nulo") {
    if (!account.pxeRegistered || !isBoundAztecAddress(account, ethAddress)) return false;
    return true;
  }
  if (!account.fromDfClient || !account.pxeRegistered) return false;
  if (!account.signingKey?.trim()) return false;
  if (!isBoundAztecAddress(account, ethAddress)) return false;
  try {
    assertDfClientAccount(account);
  } catch {
    return false;
  }
  return true;
}

export function assertBridgeReadyDfPxeAccount(
  account: ImportedAztecAccount | null | undefined,
  ethAddress: string | null | undefined,
): ImportedAztecAccount {
  if (!isBridgeReadyDfPxeAccount(account, ethAddress)) {
    throw new Error(
      "Bridge requires a DF Aztec account in PXE while your wallet session is active. Import a dfpunk-account JSON or create a DF account.",
    );
  }
  return account;
}
