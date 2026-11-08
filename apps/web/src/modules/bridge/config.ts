import { assertSafeClaimApiBase } from "../../lib/api-base.ts";
import { assertPinnedFeeRecipient } from "../../lib/fee-recipient.ts";
import { assertPinnedSponsoredFpc } from "../../lib/sponsored-fpc.ts";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
assertSafeClaimApiBase(API_BASE);

export const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? "";

/** Pinned treasury — 5% AZTEC + mainnet ETH service fee. Env may only repeat this address. */
export const BRIDGE_FEE_RECIPIENT = assertPinnedFeeRecipient(
  import.meta.env.VITE_BRIDGE_FEE_RECIPIENT as string | undefined,
);

/** Pinned L2 Sponsored FPC — env may only repeat this address. */
export const SPONSORED_FPC_ADDRESS = assertPinnedSponsoredFpc(
  import.meta.env.VITE_SPONSORED_FPC_ADDRESS as string | undefined,
);

export const BRIDGE_PUBLIC_URL =
  (import.meta.env.VITE_BRIDGE_PUBLIC_URL as string | undefined)?.trim() ||
  "https://aztec-dfarchon-kit.netlify.app/";

export const DFPUNK_PLAY_URL =
  (import.meta.env.VITE_DFPUNK_PLAY_URL as string | undefined)?.trim() ||
  "https://aztec.dfpunk.xyz/play/";

/** Build-time: include / use in-browser PXE claim (heavy chunk). */
export const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM !== "false";
