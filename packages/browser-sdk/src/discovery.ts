import type { EIP1193Provider } from "viem";

/**
 * EIP-6963 multi-injected provider discovery.
 * Prefer this over ambient `window.ethereum` when several wallets are installed.
 */

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export const LEGACY_WALLET_RDNS = "legacy.window.ethereum";

const GENERIC_WALLET_ICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="3" fill="%23667"/><circle cx="17" cy="12" r="1.6" fill="%23fff"/></svg>';

const providers = new Map<string, EIP6963ProviderDetail>();
const subscribers = new Set<() => void>();
let snapshot: EIP6963ProviderDetail[] = [];
let started = false;

function emit() {
  snapshot = [...providers.values()];
  for (const notify of subscribers) notify();
}

function handleAnnounce(event: Event) {
  const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
  if (!detail?.info?.rdns || typeof detail.provider?.request !== "function") return;
  const legacy = providers.get(LEGACY_WALLET_RDNS);
  if (legacy && legacy.provider === detail.provider) providers.delete(LEGACY_WALLET_RDNS);
  providers.set(detail.info.rdns, detail);
  emit();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", handleAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const injected = (window as { ethereum?: EIP1193Provider }).ethereum;
  if (providers.size === 0 && typeof injected?.request === "function") {
    providers.set(LEGACY_WALLET_RDNS, {
      info: {
        uuid: LEGACY_WALLET_RDNS,
        name: "Browser Wallet",
        icon: GENERIC_WALLET_ICON,
        rdns: LEGACY_WALLET_RDNS,
      },
      provider: injected,
    });
    emit();
  }
}

export function subscribeWallets(onChange: () => void): () => void {
  start();
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export function getWalletsSnapshot(): EIP6963ProviderDetail[] {
  start();
  return snapshot;
}

/** One-shot discovery (waits briefly for extensions to announce). */
export async function discoverWallets(timeoutMs = 150): Promise<EIP6963ProviderDetail[]> {
  start();
  if (snapshot.length > 0) return snapshot;
  await new Promise((r) => setTimeout(r, timeoutMs));
  return getWalletsSnapshot();
}
