import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  getContractAddress,
  http,
  keccak256,
  type Account,
  type Chain,
  type Hex,
} from "viem";
import {
  BRIDGE_CONTRACT_BYTECODE,
  BRIDGE_CONTRACT_RUNTIME_BYTECODE,
  BRIDGE_CONTRACT_ABI,
} from "../generated/bridge-contract-artifacts.ts";

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

export function buildDeployCalldata(config: GoBridgeDeployConfig): Hex {
  return (BRIDGE_SALT + getBridgeInitCode(config).slice(2)) as Hex;
}

export function expectedRuntimeBytecodeHash(): Hex {
  return keccak256(BRIDGE_CONTRACT_RUNTIME_BYTECODE);
}

export async function deployBridge(params: {
  rpcUrl: string;
  account: Account;
  chain: Chain;
  config: GoBridgeDeployConfig;
}): Promise<Hex> {
  const address = getBridgeAddress(params.config);
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: http(params.rpcUrl),
  });

  const existingCode = await publicClient.getCode({ address });
  if (existingCode && existingCode !== "0x") {
    if (keccak256(existingCode) !== expectedRuntimeBytecodeHash()) {
      throw new Error(`GoBridge at ${address} has unexpected runtime bytecode`);
    }
    return address;
  }

  const walletClient = createWalletClient({
    account: params.account,
    chain: params.chain,
    transport: http(params.rpcUrl),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await (walletClient.sendTransaction as any)({
    to: CREATE2_PROXY,
    data: buildDeployCalldata(params.config),
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const deployed = await publicClient.getCode({ address });
  if (!deployed || deployed === "0x") {
    throw new Error(`GoBridge deploy failed: no code at ${address}`);
  }
  if (keccak256(deployed) !== expectedRuntimeBytecodeHash()) {
    throw new Error(`GoBridge deploy produced unexpected runtime bytecode at ${address}`);
  }
  return address;
}

export const ANVIL_DEV_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type ChainName = "sepolia" | "mainnet" | "anvil";

export { BRIDGE_CONTRACT_ABI, BRIDGE_CONTRACT_BYTECODE, BRIDGE_CONTRACT_RUNTIME_BYTECODE };
