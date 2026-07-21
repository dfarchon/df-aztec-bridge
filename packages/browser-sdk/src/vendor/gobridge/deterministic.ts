import { getContractAddress, type Hex } from "viem";
import { BRIDGE_CONTRACT_BYTECODE, BRIDGE_CONTRACT_ABI } from "./bridge-contract-artifacts.js";

export const CREATE2_PROXY: Hex = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const BRIDGE_SALT: Hex = ("0x" + "00".repeat(32)) as Hex;

export function getBridgeAddress(): Hex {
  return getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_PROXY,
    salt: BRIDGE_SALT,
    bytecode: BRIDGE_CONTRACT_BYTECODE,
  });
}

export { BRIDGE_CONTRACT_ABI, BRIDGE_CONTRACT_BYTECODE };
