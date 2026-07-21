export type {
  BridgeTimingMode,
  L1Backend,
  NetworkConfig,
  ClaimCredentials,
  BridgeJobResult,
  RuntimeSecrets,
} from "./core/types.js";

export {
  listNetworkIds,
  loadNetworkConfig,
  resolveL1Backend,
  resolveNetworkId,
  loadRuntimeSecrets,
} from "./config/index.js";

export {
  runBridgePipeline,
  bridgeL1Only,
  waitAndClaimFromCredentials,
  createAztecAccount,
  DEFAULT_ACCOUNT_SALT,
  type RunBridgePipelineOptions,
  type CreateAztecAccountOptions,
  type CreatedAztecAccount,
} from "./core/pipeline.js";

export { waitForL1ToL2Message } from "./core/bridging.js";
export { claimWithBootstrap, claimBatch } from "./core/claim.js";
export { createNode } from "./core/node.js";
export { fetchL1Addresses } from "./core/l1/l1-addresses.js";
export { bridgeFeeJuiceOnL1, type L1BridgeParams, type L1BridgeResult } from "./core/l1/index.js";
export { getBridgeAddress } from "./vendor/gobridge/deterministic.js";
export { deployL1Bridge, type ChainName, type DeployL1BridgeParams } from "./vendor/gobridge/deterministic.js";
