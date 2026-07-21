import type { Hex } from "viem";

export interface L1Addresses {
  feeJuicePortal: Hex;
  feeJuice: Hex;
  feeAssetHandler: Hex | null;
}
