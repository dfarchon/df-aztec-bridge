import { encodeDeployData, getContractAddress, type Hex } from "viem";
import {
  BRIDGE_CONTRACT_BYTECODE,
  BRIDGE_CONTRACT_RUNTIME_BYTECODE,
  BRIDGE_CONTRACT_ABI,
} from "./bridge-contract-artifacts.ts";

export const CREATE2_PROXY: Hex = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const BRIDGE_SALT: Hex = ("0x" + "00".repeat(32)) as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;
export const DEFAULT_RESCUE_BENEFICIARY =
  "0x000000000000000000000000000000000000dEaD" as Hex;

export interface GoBridgeDeployConfig {
  feeJuice: Hex;
  portal: Hex;
  feeAssetHandler: Hex;
  rescueBeneficiary: Hex;
  feeRecipient: Hex;
}

export function getBridgeInitCode(config: GoBridgeDeployConfig): Hex {
  return encodeDeployData({
    abi: BRIDGE_CONTRACT_ABI,
    bytecode: BRIDGE_CONTRACT_BYTECODE,
    args: [
      config.feeJuice,
      config.portal,
      config.feeAssetHandler,
      config.rescueBeneficiary,
      config.feeRecipient,
    ],
  });
}

export function getBridgeAddress(config: GoBridgeDeployConfig): Hex {
  return getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_PROXY,
    salt: BRIDGE_SALT,
    bytecode: getBridgeInitCode(config),
  });
}

export { BRIDGE_CONTRACT_ABI, BRIDGE_CONTRACT_BYTECODE, BRIDGE_CONTRACT_RUNTIME_BYTECODE };
