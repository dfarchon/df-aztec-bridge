export type {
  BridgeTimingMode,
  L1Backend,
  NetworkConfig,
  ClaimCredentials,
  BridgeJobResult,
  RuntimeSecrets,
} from "./core/types.ts";

export {
  listNetworkIds,
  loadNetworkConfig,
  resolveL1Backend,
  resolveNetworkId,
  loadRuntimeSecrets,
} from "./config/index.ts";

export { SUPPORTED_AZTEC_CLIENT_VERSION, assertAztecNodeVersionCompatible } from "./core/version-guard.ts";
export {
  computeBridgeFee,
  BRIDGE_FEE_BPS,
  BRIDGE_ETH_FEE_CHAIN_ID,
  BRIDGE_ETH_SERVICE_FEE_GAS,
  isValidFeeRecipient,
  shouldChargeBridgeEthServiceFee,
  parseEthFeeWeiOverride,
} from "./core/fee.ts";

export {
  runBridgePipeline,
  bridgeL1Only,
  waitAndClaimFromCredentials,
  createAztecAccount,
  DEFAULT_ACCOUNT_SALT,
  type RunBridgePipelineOptions,
  type CreateAztecAccountOptions,
  type CreatedAztecAccount,
} from "./core/pipeline.ts";

export { waitForL1ToL2Message } from "./core/bridging.ts";
export { claimWithBootstrap, claimBatch } from "./core/claim.ts";
export { createNode } from "./core/node.ts";
export { fetchL1Addresses } from "./core/l1/l1-addresses.ts";
export { bridgeFeeJuiceOnL1, type L1BridgeParams, type L1BridgeResult } from "./core/l1/index.ts";
export { getBridgeAddress, DEFAULT_RESCUE_BENEFICIARY, ZERO_ADDRESS } from "./vendor/gobridge/deterministic.ts";
export { deployL1Bridge, type ChainName, type DeployL1BridgeParams, type GoBridgeDeployConfig } from "./vendor/gobridge/deterministic.ts";
