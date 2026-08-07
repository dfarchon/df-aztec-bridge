import type { EIP1193Provider, Hex } from "viem";
import {
  discoverWallets,
  type EIP6963ProviderDetail,
} from "./discovery.ts";

export type { EIP6963ProviderDetail, EIP6963ProviderInfo } from "./discovery.ts";
export {
  discoverWallets,
  getWalletsSnapshot,
  subscribeWallets,
  LEGACY_WALLET_RDNS,
} from "./discovery.ts";

export interface ConnectedWallet {
  provider: EIP1193Provider;
  address: Hex;
  chainId: number;
  /** EIP-6963 rdns when known (e.g. io.metamask). */
  rdns?: string;
  name?: string;
}

type Eip1193Request = (args: { method: string; params?: unknown }) => Promise<unknown>;
const rpc = (provider: EIP1193Provider) => provider.request as Eip1193Request;

/** MetaMask / OKX / etc. user closed or rejected the popup. */
export function isWalletUserRejection(err: unknown): boolean {
  const e = err as { code?: number | string; message?: string; name?: string } | null;
  if (!e) return false;
  if (e.code === 4001 || e.code === "ACTION_REJECTED" || e.code === 5000) return true;
  const msg = `${e.message ?? ""} ${e.name ?? ""}`.toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("rejected the request") ||
    msg.includes("request rejected") ||
    msg.includes("user cancelled") ||
    msg.includes("user canceled")
  );
}

export function formatWalletError(err: unknown): string {
  if (isWalletUserRejection(err)) {
    return "Wallet connection cancelled. You can pick a wallet again.";
  }
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "Wallet request",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out after ${Math.round(ms / 1000)}s. Close any stuck wallet popup and try again.`,
            ),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function connectWithProvider(
  provider: EIP1193Provider,
  meta?: { rdns?: string; name?: string },
): Promise<ConnectedWallet> {
  const label = meta?.name ?? "Wallet";

  // Probe first — MetaMask sometimes leaves eth_requestAccounts hanging forever
  // when the inpage stream is dead (no popup, no rejection).
  try {
    await withTimeout(
      rpc(provider)({ method: "eth_chainId" }),
      8_000,
      `${label} probe`,
    );
  } catch {
    throw new Error(
      `${label} is not responding. Close the extension popup, refresh this page, unlock the wallet, then connect again.`,
    );
  }

  const accounts = (await withTimeout(
    rpc(provider)({ method: "eth_requestAccounts" }),
    90_000,
    `Connect ${label}`,
  )) as string[];

  const address = accounts[0] as Hex | undefined;
  if (!address) {
    throw new Error(`${label} returned no accounts. Unlock it and approve the connection.`);
  }

  const chainIdHex = (await withTimeout(
    rpc(provider)({ method: "eth_chainId" }),
    15_000,
    "Read chain id",
  )) as string;
  const chainId = Number.parseInt(chainIdHex, 16);

  return {
    provider,
    address,
    chainId,
    rdns: meta?.rdns,
    name: meta?.name,
  };
}

/**
 * Connect using a specific EIP-6963 wallet (preferred).
 */
export async function connectEvmWalletDetail(wallet: EIP6963ProviderDetail): Promise<ConnectedWallet> {
  return connectWithProvider(wallet.provider, {
    rdns: wallet.info.rdns,
    name: wallet.info.name,
  });
}

/**
 * @deprecated Prefer listing wallets via discoverWallets + connectEvmWalletDetail.
 * Falls back to window.ethereum — whichever extension won the injection race.
 */
export async function connectEvmWallet(): Promise<ConnectedWallet> {
  const wallets = await discoverWallets();
  if (wallets.length === 1) {
    return connectEvmWalletDetail(wallets[0]);
  }
  if (wallets.length > 1) {
    throw new Error(
      `Multiple wallets detected (${wallets.map((w) => w.info.name).join(", ")}). Pick one explicitly.`,
    );
  }

  const provider = (window as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) {
    throw new Error("No EIP-1193 wallet found. Install MetaMask or another Web3 wallet.");
  }
  return connectWithProvider(provider, { name: "Browser Wallet" });
}

export async function switchWalletChain(
  provider: EIP1193Provider,
  chainId: number,
): Promise<void> {
  const hex = `0x${chainId.toString(16)}`;
  try {
    await withTimeout(
      rpc(provider)({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      }),
      120_000,
      "Switch network",
    );
  } catch (err: unknown) {
    if (isWalletUserRejection(err)) throw err;
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      throw new Error(`Chain ${chainId} is not added to your wallet. Add it manually and retry.`);
    }
    throw err;
  }
}
