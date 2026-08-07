/**
 * Lazy loader for browser claim — keeps the heavy Aztec chunk out of the
 * initial bundle until boot warmup / claim actually needs it.
 */
export type {
  BrowserClaimProgress,
  ClaimMessageStatus,
  QuickDfpunkAccount,
} from "./claim-browser.ts";
export type WaitAndClaimInBrowser = typeof import("./claim-browser.ts").waitAndClaimInBrowser;
export type WarmupBrowserClaim = typeof import("./claim-browser.ts").warmupBrowserClaim;
export type WaitForL2ClaimTx = typeof import("./claim-browser.ts").waitForL2ClaimTx;
export type GetClaimMessageStatus = typeof import("./claim-browser.ts").getClaimMessageStatus;
export type CreateQuickDfpunkAccount = typeof import("./claim-browser.ts").createQuickDfpunkAccount;
export type ImportDfpunkAccountIntoPxe =
  typeof import("./claim-browser.ts").importDfpunkAccountIntoPxe;

export async function loadBrowserClaim(): Promise<{
  waitAndClaimInBrowser: WaitAndClaimInBrowser;
  warmupBrowserClaim: WarmupBrowserClaim;
  waitForL2ClaimTx: WaitForL2ClaimTx;
  getClaimMessageStatus: GetClaimMessageStatus;
  createQuickDfpunkAccount: CreateQuickDfpunkAccount;
  importDfpunkAccountIntoPxe: ImportDfpunkAccountIntoPxe;
}> {
  const mod = await import("./claim-browser.ts");
  return {
    waitAndClaimInBrowser: mod.waitAndClaimInBrowser,
    warmupBrowserClaim: mod.warmupBrowserClaim,
    waitForL2ClaimTx: mod.waitForL2ClaimTx,
    getClaimMessageStatus: mod.getClaimMessageStatus,
    createQuickDfpunkAccount: mod.createQuickDfpunkAccount,
    importDfpunkAccountIntoPxe: mod.importDfpunkAccountIntoPxe,
  };
}
