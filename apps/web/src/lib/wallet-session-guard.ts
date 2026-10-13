/**
 * Harden Web3 connector sessions: EIP-6963 / WalletConnect only.
 * Rejects anonymous window.ethereum injection as insufficient to unlock DF PXE.
 */

import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import { LEGACY_WALLET_RDNS } from "@df-bridge/browser-sdk";
import type { EIP1193Provider } from "viem";
import { redactForLog } from "./privacy.ts";

export class WalletSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletSessionError";
  }
}

/** EIP-6963 announced wallet or WalletConnect — not legacy race-winner inject. */
export function isTrustedConnector(wallet: ConnectedWallet | null): boolean {
  if (!wallet?.provider || typeof wallet.provider.request !== "function") return false;
  if (!wallet.address || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) return false;
  const rdns = wallet.rdns?.trim() ?? "";
  if (!rdns || rdns === LEGACY_WALLET_RDNS) return false;
  return true;
}

export function assertSecureWalletContext(): void {
  if (typeof window === "undefined") return;
  if (import.meta.env.PROD && !window.isSecureContext) {
    throw new WalletSessionError(
      "Open this site over HTTPS to connect a wallet.",
    );
  }
}

/**
 * Live-check the provider: eth_accounts + eth_chainId must match ConnectedWallet.
 * Mitigates stale UI state and simple provider spoofing after connect.
 */
export async function validateConnectedWalletSession(
  wallet: ConnectedWallet,
): Promise<ConnectedWallet> {
  assertSecureWalletContext();
  if (!isTrustedConnector(wallet)) {
    throw new WalletSessionError(
      "Connect MetaMask or WalletConnect. This browser wallet isn't supported.",
    );
  }

  const provider = wallet.provider as EIP1193Provider;
  const request = provider.request as (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;

  let accounts: string[];
  let chainIdHex: string;
  try {
    accounts = (await request({ method: "eth_accounts" })) as string[];
    chainIdHex = (await request({ method: "eth_chainId" })) as string;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new WalletSessionError(
      `Wallet session check failed: ${redactForLog(msg)}. Reconnect the connector.`,
    );
  }

  const live = accounts?.[0]?.toLowerCase();
  if (!live) {
    throw new WalletSessionError("Wallet has no accounts. Unlock / reconnect the connector.");
  }
  if (live !== wallet.address.toLowerCase()) {
    throw new WalletSessionError(
      "Connected address changed in the wallet. Reconnect before using DF Punk PXE.",
    );
  }

  const chainId = Number.parseInt(String(chainIdHex), 16);
  if (!Number.isFinite(chainId)) {
    throw new WalletSessionError("Wallet returned an invalid chain id.");
  }

  return { ...wallet, chainId, address: wallet.address };
}

export async function tryValidateConnectedWalletSession(
  wallet: ConnectedWallet | null,
): Promise<{ ok: true; wallet: ConnectedWallet } | { ok: false; reason: string }> {
  if (!wallet) return { ok: false, reason: "Connect a wallet first." };
  try {
    const validated = await validateConnectedWalletSession(wallet);
    return { ok: true, wallet: validated };
  } catch (e: unknown) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
