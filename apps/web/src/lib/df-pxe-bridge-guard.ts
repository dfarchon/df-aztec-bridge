/**
 * Bridge may only run against a DF Punk account that was registered into PXE
 * under a live, trusted Web3 connector session.
 */

import type { ImportedAztecAccount } from "./account-import.ts";
import { assertDfClientAccount } from "./account-import.ts";

export function isBridgeReadyDfPxeAccount(
  account: ImportedAztecAccount | null | undefined,
  ethAddress: string | null | undefined,
): account is ImportedAztecAccount {
  if (!account || !ethAddress) return false;
  if (account.connector === "nulo") {
    if (!account.pxeRegistered || !account.boundEthAddress) return false;
    if (account.boundEthAddress.toLowerCase() !== ethAddress.toLowerCase()) return false;
    return /^0x[0-9a-fA-F]{64}$/i.test(account.address);
  }
  if (!account.fromDfClient || !account.pxeRegistered) return false;
  if (!account.signingKey?.trim()) return false;
  if (!account.boundEthAddress) return false;
  if (account.boundEthAddress.toLowerCase() !== ethAddress.toLowerCase()) return false;
  try {
    assertDfClientAccount(account);
  } catch {
    return false;
  }
  return /^0x[0-9a-fA-F]{64}$/i.test(account.address);
}

export function assertBridgeReadyDfPxeAccount(
  account: ImportedAztecAccount | null | undefined,
  ethAddress: string | null | undefined,
): ImportedAztecAccount {
  if (!isBridgeReadyDfPxeAccount(account, ethAddress)) {
    throw new Error(
      "Bridge requires an Aztec 6.0 account in PXE while your wallet session is active. Create a 6.0 wallet or import a 6.0 account file.",
    );
  }
  return account;
}
