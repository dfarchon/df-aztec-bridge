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
import { privateKeyToAccount } from "viem/accounts";
import { foundry, mainnet, sepolia } from "viem/chains";
import { waitForTransactionReceiptWithRetry } from "../../core/l1/clients.ts";
import {
  BRIDGE_CONTRACT_BYTECODE,
  BRIDGE_CONTRACT_RUNTIME_BYTECODE,
  BRIDGE_CONTRACT_ABI,
} from "./bridge-contract-artifacts.ts";

/**
 * Arachnid deterministic-deployment-proxy — pre-deployed at the same address
 * on most chains, including Anvil. Calling it with `salt ++ initcode` deploys
 * via CREATE2. Address depends on creation bytecode + constructor args.
 */
export const CREATE2_PROXY: Hex = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

/** Salt used for every GoBridge deployment. */
export const BRIDGE_SALT: Hex = ("0x" + "00".repeat(32)) as Hex;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;
/** Default surplus / rescue sink — keeps CREATE2 address independent of deployer EOA. */
export const DEFAULT_RESCUE_BENEFICIARY =
  "0x000000000000000000000000000000000000dEaD" as Hex;

export interface GoBridgeDeployConfig {
  feeJuice: Hex;
  portal: Hex;
  /** Use ZERO_ADDRESS when the network has no faucet handler. */
  feeAssetHandler: Hex;
  rescueBeneficiary: Hex;
  feeRecipient: Hex;
}

/** Official Sepolia / mainnet Fee Juice addresses (Aztec docs). */
export const NETWORK_BRIDGE_CONFIGS: Record<
  "sepolia" | "mainnet",
  Omit<GoBridgeDeployConfig, "rescueBeneficiary" | "feeRecipient">
> = {
  sepolia: {
    feeJuice: "0x762c132040fda6183066fa3b14d985ee55aa3c18",
    portal: "0xb4a9f8eadc8ca944729d61e59a9f491faff237a3",
    feeAssetHandler: "0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9",
  },
  mainnet: {
    feeJuice: "0xa27ec0006e59f245217ff08cd52a7e8b169e62d2",
    portal: "0xaf73dd51d1eb8a079bb097f39c832cdd00ac691c",
    feeAssetHandler: ZERO_ADDRESS,
  },
};

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

/** Deterministic CREATE2 address for a given constructor binding. */
export function getBridgeAddress(config: GoBridgeDeployConfig): Hex {
  return getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_PROXY,
    salt: BRIDGE_SALT,
    bytecode: getBridgeInitCode(config),
  });
}

/** Calldata accepted by the Arachnid proxy: `salt ++ initcode`. */
export function buildDeployCalldata(config: GoBridgeDeployConfig): Hex {
  return (BRIDGE_SALT + getBridgeInitCode(config).slice(2)) as Hex;
}

export function expectedRuntimeBytecodeHash(): Hex {
  return keccak256(BRIDGE_CONTRACT_RUNTIME_BYTECODE);
}

/**
 * Deploys GoBridge via the CREATE2 proxy. Idempotent only when existing
 * runtime bytecode matches the expected artifact hash.
 */
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
    const onchainHash = keccak256(existingCode);
    const expected = expectedRuntimeBytecodeHash();
    if (onchainHash !== expected) {
      throw new Error(
        `GoBridge at ${address} has unexpected runtime bytecode (got ${onchainHash}, expected ${expected}). Refuse to reuse.`,
      );
    }
    // Also verify immutables match config when possible.
    const [feeJuice, portal, handler, rescue, feeRec] = await Promise.all([
      publicClient.readContract({ address, abi: BRIDGE_CONTRACT_ABI, functionName: "feeJuice" }),
      publicClient.readContract({ address, abi: BRIDGE_CONTRACT_ABI, functionName: "portal" }),
      publicClient.readContract({ address, abi: BRIDGE_CONTRACT_ABI, functionName: "feeAssetHandler" }),
      publicClient.readContract({
        address,
        abi: BRIDGE_CONTRACT_ABI,
        functionName: "rescueBeneficiary",
      }),
      publicClient.readContract({ address, abi: BRIDGE_CONTRACT_ABI, functionName: "feeRecipient" }),
    ]);
    const cfg = params.config;
    if (
      (feeJuice as string).toLowerCase() !== cfg.feeJuice.toLowerCase() ||
      (portal as string).toLowerCase() !== cfg.portal.toLowerCase() ||
      (handler as string).toLowerCase() !== cfg.feeAssetHandler.toLowerCase() ||
      (rescue as string).toLowerCase() !== cfg.rescueBeneficiary.toLowerCase() ||
      (feeRec as string).toLowerCase() !== cfg.feeRecipient.toLowerCase()
    ) {
      throw new Error(
        `GoBridge at ${address} immutables do not match deploy config. Refuse to reuse.`,
      );
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
  await waitForTransactionReceiptWithRetry(publicClient, hash);

  const deployed = await publicClient.getCode({ address });
  if (!deployed || deployed === "0x") {
    throw new Error(`GoBridge deploy failed: no code at ${address}`);
  }
  if (keccak256(deployed) !== expectedRuntimeBytecodeHash()) {
    throw new Error(`GoBridge deploy produced unexpected runtime bytecode at ${address}`);
  }
  return address;
}

/** Anvil's deterministic account #0 — NOT A SECRET. */
export const ANVIL_DEV_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type ChainName = "sepolia" | "mainnet" | "anvil";

const CHAINS: Record<ChainName, { chain: Chain; defaultRpc: string }> = {
  sepolia: { chain: sepolia, defaultRpc: "https://sepolia.drpc.org" },
  mainnet: { chain: mainnet, defaultRpc: "https://eth.drpc.org" },
  anvil: { chain: foundry, defaultRpc: "http://localhost:8545" },
};

export interface DeployL1BridgeParams {
  chainName: ChainName;
  rpcUrl?: string;
  deployerKey?: Hex;
  /** Required constructor binding. For sepolia/mainnet, defaults from NETWORK_BRIDGE_CONFIGS. */
  config?: GoBridgeDeployConfig;
  rescueBeneficiary?: Hex;
  /** Required for preset deploys — anonymous Trezor / treasury (BRIDGE_FEE_RECIPIENT). */
  feeRecipient?: Hex;
}

export async function deployL1Bridge(params: DeployL1BridgeParams): Promise<Hex> {
  const entry = CHAINS[params.chainName];
  const key = params.deployerKey ?? (params.chainName === "anvil" ? ANVIL_DEV_KEY : undefined);
  if (!key) {
    throw new Error(`deployerKey is required for ${params.chainName}`);
  }
  const account = privateKeyToAccount(key);

  let config = params.config;
  if (!config) {
    if (params.chainName === "anvil") {
      throw new Error(
        "anvil deploy requires explicit config (feeJuice, portal, feeAssetHandler, rescueBeneficiary, feeRecipient)",
      );
    }
    if (!params.feeRecipient) {
      throw new Error("feeRecipient is required (set BRIDGE_FEE_RECIPIENT in .env)");
    }
    const preset = NETWORK_BRIDGE_CONFIGS[params.chainName];
    config = {
      ...preset,
      rescueBeneficiary: params.rescueBeneficiary ?? DEFAULT_RESCUE_BENEFICIARY,
      feeRecipient: params.feeRecipient,
    };
  }

  return deployBridge({
    rpcUrl: params.rpcUrl ?? entry.defaultRpc,
    account,
    chain: entry.chain,
    config,
  });
}

export { BRIDGE_CONTRACT_ABI, BRIDGE_CONTRACT_BYTECODE, BRIDGE_CONTRACT_RUNTIME_BYTECODE };
