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

export interface BridgeFromWalletResult {
  l1TxHash: Hex;
  credentials: ClaimCredentials;
  sender: Hex;
}
