/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_ENABLE_BROWSER_CLAIM?: string;
  /** When "true", show maintenance page instead of the bridge UI. */
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_TESTNET_AZTEC_NODE_URL?: string;
  readonly VITE_TESTNET_L1_RPC_URL?: string;
  readonly VITE_MAINNET_AZTEC_NODE_URL?: string;
  readonly VITE_MAINNET_L1_RPC_URL?: string;
  readonly VITE_LOCAL_AZTEC_NODE_URL?: string;
  readonly VITE_LOCAL_L1_RPC_URL?: string;
  /** Same cadence as mprocs `tick` / local-network-tick (ms). */
  readonly VITE_LOCAL_TICK_INTERVAL_MS?: string;
  /** Anonymous Trezor / treasury receiving the 5% L1 AZTEC fee + mainnet ETH service fee. */
  readonly VITE_BRIDGE_FEE_RECIPIENT?: string;
  /** Optional fixed mainnet ETH service fee in wei (else estimated from gas × ~1 L1 tx). */
  readonly VITE_BRIDGE_ETH_FEE_WEI?: string;
  /** Aztec L2 Sponsored FPC address (Fee Juice funding target for DF sponsor mode). */
  readonly VITE_SPONSORED_FPC_ADDRESS?: string;
  readonly VITE_BRIDGE_PUBLIC_URL?: string;
  readonly VITE_DFPUNK_PLAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "pino-browser-entry" {
  const pinoBrowser: unknown;
  export default pinoBrowser;
}
