/**
 * Lazy loader for browser claim — keeps the heavy Aztec chunk out of the
 * initial bundle until boot warmup / claim actually needs it.
 */
export type { BrowserClaimProgress } from "./claim-browser.js";
export type WaitAndClaimInBrowser = typeof import("./claim-browser.js").waitAndClaimInBrowser;
export type WarmupBrowserClaim = typeof import("./claim-browser.js").warmupBrowserClaim;

export async function loadBrowserClaim(): Promise<{
  waitAndClaimInBrowser: WaitAndClaimInBrowser;
  warmupBrowserClaim: WarmupBrowserClaim;
}> {
  const mod = await import("./claim-browser.js");
  return {
    waitAndClaimInBrowser: mod.waitAndClaimInBrowser,
    warmupBrowserClaim: mod.warmupBrowserClaim,
  };
}
