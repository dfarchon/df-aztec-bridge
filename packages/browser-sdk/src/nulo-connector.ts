/**
 * Connect a Nulo extension through the Aztec wallet SDK.
 * Nulo keeps the account keys. This module keeps the live session in memory.
 */

import type { ChainInfo } from "@aztec-labs/aztec.js/account";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import type { AppCapabilities, Wallet, WalletCapabilities } from "@aztec-labs/aztec.js/wallet";
import { Fr } from "@aztec-labs/foundation/curves/bn254";
import { hashToEmoji } from "@aztec-labs/wallet-sdk/crypto";
import {
  WalletManager,
  type WalletProvider,
} from "@aztec-labs/wallet-sdk/manager";
import {
  claimUsingExternalWallet,
  type BrowserClaimProgress,
} from "./claim-browser.ts";
import type { ClaimCredentials } from "./types.ts";

const APP_ID = "df-aztec-bridge";
const NULO_SITE = "https://nulo.sh";

export function isNuloProvider(provider: { name: string; id: string }): boolean {
  return /nulo/i.test(provider.name) || /nulo/i.test(provider.id);
}

type NuloSession = {
  provider: WalletProvider;
  wallet: Wallet;
  address: string;
};

let session: NuloSession | null = null;
let cancelDiscovery: (() => void) | null = null;

export function getNuloAddress(): string | null {
  return session?.address ?? null;
}

export async function disconnectNulo(): Promise<void> {
  cancelDiscovery?.();
  cancelDiscovery = null;
  const current = session;
  session = null;
  if (!current) return;
  try {
    await current.provider.disconnect();
  } catch {
    /* the extension may already be gone */
  }
}

export type NuloPendingConnect = {
  walletName: string;
  verification: string;
  confirm: () => Promise<{ address: string }>;
  cancel: () => void;
};

async function chainInfoForNode(aztecNodeUrl: string): Promise<ChainInfo> {
  try {
    const response = await fetch(aztecNodeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "node_getNodeInfo",
        params: [],
      }),
    });
    const body = (await response.json()) as {
      result?: { l1ChainId?: number | string; rollupVersion?: number | string };
    };
    const chainId = body.result?.l1ChainId;
    const version = body.result?.rollupVersion;
    if (chainId != null && version != null) {
      return { chainId: new Fr(BigInt(chainId)), version: new Fr(BigInt(version)) };
    }
  } catch {
    /* Nulo still answers discovery when the filter is zero */
  }
  return { chainId: Fr.ZERO, version: Fr.ZERO };
}

function accountAddress(result: WalletCapabilities): string {
  const granted = result.granted.find((cap) => cap.type === "accounts");
  const accounts =
    granted && "accounts" in granted && Array.isArray(granted.accounts) ? granted.accounts : [];
  const first = accounts[0];
  const raw = first && typeof first === "object" && "item" in first ? first.item : first;
  const address = raw && typeof raw === "object" && "toString" in raw ? raw.toString() : String(raw ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(address)) {
    throw new Error("Nulo connected, but it did not share an Aztec account. Approve an account in Nulo.");
  }
  return address;
}

const CAPABILITIES: AppCapabilities = {
  version: "1.0",
  metadata: {
    name: APP_ID,
    version: "0.1.0",
    description: "DF Aztec Bridge",
    url: typeof window !== "undefined" ? window.location.origin : undefined,
  },
  capabilities: [
    { type: "accounts", canGet: true, canCreateAuthWit: true },
    { type: "transaction", scope: "*" },
    { type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
  ],
};

/**
 * Ask Nulo to connect. The returned confirm() finishes after the user matches
 * the verification string shown in the extension.
 */
export async function beginNuloConnect(params: {
  aztecNodeUrl: string;
}): Promise<NuloPendingConnect> {
  await disconnectNulo();
  const manager = WalletManager.configure({ extensions: { enabled: true } });
  const discovery = manager.getAvailableWallets({
    chainInfo: await chainInfoForNode(params.aztecNodeUrl),
    appId: APP_ID,
    timeout: 45_000,
  });
  cancelDiscovery = discovery.cancel;

  let found: WalletProvider | undefined;
  const others: string[] = [];
  for await (const provider of discovery.wallets) {
    if (isNuloProvider(provider)) {
      found = provider;
      break;
    }
    others.push(provider.name);
  }
  cancelDiscovery = null;
  discovery.cancel();

  if (!found) {
    const extra = others.length > 0 ? ` Found ${others.join(", ")} instead.` : "";
    throw new Error(`Nulo was not found. Install it from ${NULO_SITE}, unlock it, then try again.${extra}`);
  }

  const pending = await found.establishSecureChannel(APP_ID);
  let settled = false;
  return {
    walletName: found.name || "Nulo",
    verification: hashToEmoji(pending.verificationHash),
    cancel: () => {
      if (settled) return;
      settled = true;
      pending.cancel();
    },
    confirm: async () => {
      if (settled) throw new Error("This Nulo connection was already closed.");
      settled = true;
      const wallet = await pending.confirm();
      const granted = await wallet.requestCapabilities(CAPABILITIES);
      const address = accountAddress(granted);
      const connected: NuloSession = { provider: found, wallet, address };
      session = connected;
      found.onDisconnect(() => {
        if (session === connected) session = null;
      });
      return { address };
    },
  };
}

export async function claimWithNulo(params: {
  aztecNodeUrl: string;
  credentials: ClaimCredentials;
  timeoutMs?: number;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
  onTxSent?: (l2TxHash: string) => void;
}): Promise<{ l2TxHash: string }> {
  if (!session) {
    throw new Error("Connect Nulo again before claiming.");
  }
  if (session.address.toLowerCase() !== params.credentials.recipient.toLowerCase()) {
    throw new Error("The connected Nulo account does not match this claim recipient.");
  }
  return claimUsingExternalWallet({
    wallet: session.wallet,
    from: AztecAddress.fromStringUnsafe(session.address),
    aztecNodeUrl: params.aztecNodeUrl,
    credentials: params.credentials,
    timeoutMs: params.timeoutMs,
    onProgress: params.onProgress,
    onTxSent: params.onTxSent,
  });
}
