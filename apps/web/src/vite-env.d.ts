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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "pino-browser-entry" {
  const pinoBrowser: unknown;
  export default pinoBrowser;
}
