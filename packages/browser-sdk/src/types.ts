import type { Hex } from "viem";

export interface L1Addresses {
  l1ChainId: number;
  feeJuice: Hex;
  feeJuicePortal: Hex;
  feeAssetHandler: Hex | null;
}

export interface ClaimCredentials {
  claimSecret: string;
  claimSecretHash: string;
  messageHash: string;
  messageLeafIndex: string;
  claimAmount: string;
  recipient: string;
}

/**
 * Claim data available after the L1 transaction is submitted but before its
 * deposit event has been parsed into complete claim credentials.
 */
export interface PendingBridge {
  l1TxHash: Hex;
  claimSecret: Hex;
  claimSecretHash: Hex;
  claimAmount: string;
  recipient: string;
}

export interface BridgeFromWalletResult {
  l1TxHash: Hex;
  credentials: ClaimCredentials;
  sender: Hex;
}
