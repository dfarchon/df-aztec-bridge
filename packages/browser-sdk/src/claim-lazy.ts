/**
 * Lazy loader for browser claim — keeps the heavy Aztec chunk out of the
 * initial bundle until boot warmup / claim actually needs it.
 */
export type {
  BrowserClaimProgress,
  ClaimMessageStatus,
} from "./claim-browser.js";
export type WaitAndClaimInBrowser = typeof import("./claim-browser.js").waitAndClaimInBrowser;
export type WarmupBrowserClaim = typeof import("./claim-browser.js").warmupBrowserClaim;
export type WaitForL2ClaimTx = typeof import("./claim-browser.js").waitForL2ClaimTx;
export type GetClaimMessageStatus = typeof import("./claim-browser.js").getClaimMessageStatus;

export async function loadBrowserClaim(): Promise<{
  waitAndClaimInBrowser: WaitAndClaimInBrowser;
  warmupBrowserClaim: WarmupBrowserClaim;
  waitForL2ClaimTx: WaitForL2ClaimTx;
  getClaimMessageStatus: GetClaimMessageStatus;
}> {
  const mod = await import("./claim-browser.js");
  return {
    waitAndClaimInBrowser: mod.waitAndClaimInBrowser,
    warmupBrowserClaim: mod.warmupBrowserClaim,
    waitForL2ClaimTx: mod.waitForL2ClaimTx,
    getClaimMessageStatus: mod.getClaimMessageStatus,
  };
}
