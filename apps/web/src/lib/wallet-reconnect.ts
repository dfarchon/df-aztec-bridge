import { LEGACY_WALLET_RDNS, type ConnectedWallet, type EIP6963ProviderDetail } from "@df-bridge/browser-sdk";
import type { Hex } from "viem";

const STORAGE_KEY = "dfaztec.wallet-connector.v1";
export const DISCONNECTED_CONNECTOR = "disconnected";

export function getRememberedConnector(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return DISCONNECTED_CONNECTOR; }
}

export function rememberConnector(rdns: string): void {
  try { localStorage.setItem(STORAGE_KEY, rdns); } catch { /* Storage is optional. */ }
}

/** Only restore a previously authorized, unambiguous EIP-6963 account without a wallet prompt. */
export async function findAuthorizedWallet(
  wallets: EIP6963ProviderDetail[],
  remembered: string | null,
  expectedChain: number,
): Promise<ConnectedWallet | null> {
  if (remembered === DISCONNECTED_CONNECTOR || remembered === "walletconnect") return null;
  const candidates = wallets.filter(({ info }) =>
    !!info.rdns && info.rdns !== LEGACY_WALLET_RDNS && (!remembered || info.rdns === remembered),
  );
  const probe = async (detail: EIP6963ProviderDetail): Promise<ConnectedWallet | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const requests = Promise.all([
        detail.provider.request({ method: "eth_accounts" }),
        detail.provider.request({ method: "eth_chainId" }),
      ]);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Wallet probe timed out")), 2000);
      });
      const [accounts, chain] = await Promise.race([requests, timeout]);
      const address = Array.isArray(accounts) ? accounts[0] : null;
      if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
      if (typeof chain !== "string" || !/^0x[0-9a-fA-F]+$/.test(chain)) return null;
      const chainId = Number.parseInt(chain, 16);
      if (!Number.isSafeInteger(chainId) || chainId !== expectedChain) return null;
      return { provider: detail.provider, address: address as Hex, chainId, rdns: detail.info.rdns, name: detail.info.name };
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const authorized = (await Promise.all(candidates.map(probe))).filter((wallet): wallet is ConnectedWallet => wallet !== null);
  return authorized.length === 1 ? authorized[0] : null;
}
