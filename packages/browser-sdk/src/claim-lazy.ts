/**
 * Lazy loader for browser claim — keeps the heavy Aztec chunk out of the
 * initial bundle until boot warmup / claim actually needs it.
 */
export type {
  AztecWalletCompat,
  BrowserClaimProgress,
  ClaimMessageStatus,
  QuickDfpunkAccount,
} from "./claim-browser.ts";
export type WaitAndClaimInBrowser = typeof import("./claim-browser.ts").waitAndClaimInBrowser;
export type WarmupBrowserClaim = typeof import("./claim-browser.ts").warmupBrowserClaim;
export type WaitForL2ClaimTx = typeof import("./claim-browser.ts").waitForL2ClaimTx;
export type GetClaimMessageStatus = typeof import("./claim-browser.ts").getClaimMessageStatus;
export type GetAztecFeeJuiceBalance = typeof import("./claim-browser.ts").getAztecFeeJuiceBalance;
export type CreateQuickDfpunkAccount = typeof import("./claim-browser.ts").createQuickDfpunkAccount;
export type ImportDfpunkAccountIntoPxe =
  typeof import("./claim-browser.ts").importDfpunkAccountIntoPxe;
export type ClassifyAztecWalletCompat =
  typeof import("./claim-browser.ts").classifyAztecWalletCompat;
export type DeriveVerifiedV6DfpunkAccount =
  typeof import("./claim-browser.ts").deriveVerifiedV6DfpunkAccount;

export async function loadBrowserClaim(): Promise<{
  waitAndClaimInBrowser: WaitAndClaimInBrowser;
  warmupBrowserClaim: WarmupBrowserClaim;
  waitForL2ClaimTx: WaitForL2ClaimTx;
  getClaimMessageStatus: GetClaimMessageStatus;
  getAztecFeeJuiceBalance: GetAztecFeeJuiceBalance;
  createQuickDfpunkAccount: CreateQuickDfpunkAccount;
  importDfpunkAccountIntoPxe: ImportDfpunkAccountIntoPxe;
  classifyAztecWalletCompat: ClassifyAztecWalletCompat;
  deriveVerifiedV6DfpunkAccount: DeriveVerifiedV6DfpunkAccount;
}> {
  const mod = await import("./claim-browser.ts");
  return {
    waitAndClaimInBrowser: mod.waitAndClaimInBrowser,
    warmupBrowserClaim: mod.warmupBrowserClaim,
    waitForL2ClaimTx: mod.waitForL2ClaimTx,
    getClaimMessageStatus: mod.getClaimMessageStatus,
    getAztecFeeJuiceBalance: mod.getAztecFeeJuiceBalance,
    createQuickDfpunkAccount: mod.createQuickDfpunkAccount,
    importDfpunkAccountIntoPxe: mod.importDfpunkAccountIntoPxe,
    classifyAztecWalletCompat: mod.classifyAztecWalletCompat,
    deriveVerifiedV6DfpunkAccount: mod.deriveVerifiedV6DfpunkAccount,
  };
}
