import { parseEthFeeWeiOverride } from "@df-bridge/browser-sdk";
import { assertSafeClaimApiBase } from "../../lib/api-base.ts";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
assertSafeClaimApiBase(API_BASE);

export const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";

/** Anonymous Trezor / treasury — 5% AZTEC + mainnet ETH service fee. */
export const BRIDGE_FEE_RECIPIENT = (import.meta.env.VITE_BRIDGE_FEE_RECIPIENT as string | undefined)?.trim() ?? "";

/** Optional fixed mainnet ETH service fee (wei). Empty = estimate from gas × ~1 L1 tx. */
export const BRIDGE_ETH_FEE_WEI_OVERRIDE = parseEthFeeWeiOverride(
  (import.meta.env.VITE_BRIDGE_ETH_FEE_WEI as string | undefined) ?? "",
);

export const BRIDGE_PUBLIC_URL =
  (import.meta.env.VITE_BRIDGE_PUBLIC_URL as string | undefined)?.trim() ||
  "https://df-atlas.onchainreality.xyz/";

export const DFPUNK_PLAY_URL =
  (import.meta.env.VITE_DFPUNK_PLAY_URL as string | undefined)?.trim() ||
  "https://aztec.dfpunk.xyz/play/";

/** Build-time: include / use in-browser PXE claim (heavy chunk). */
export const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM !== "false";
