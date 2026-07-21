/**
 * Lazy loader for browser claim — keeps the heavy Aztec chunk out of the
 * initial bundle until auto-claim actually runs (and only if the feature is built in).
 */
export type { BrowserClaimProgress } from "./claim-browser.js";
export type WaitAndClaimInBrowser = typeof import("./claim-browser.js").waitAndClaimInBrowser;

export async function loadBrowserClaim(): Promise<{
  waitAndClaimInBrowser: WaitAndClaimInBrowser;
}> {
  const mod = await import("./claim-browser.js");
  return { waitAndClaimInBrowser: mod.waitAndClaimInBrowser };
}
