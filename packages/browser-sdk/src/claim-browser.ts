/**
 * Browser L2 claim (EmbeddedWallet + PXE). Heavy — load via dynamic import only.
 */
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { Fr } from "@aztec/foundation/curves/bn254";
import { defaultFetch } from "@aztec/foundation/json-rpc/client";
import { getPXEConfig } from "@aztec/pxe/config";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { deriveMasterMessageSigningSecretKey } from "@aztec/stdlib/keys";
import { EmbeddedWallet } from "@aztec/wallets/embedded";

import type { ClaimCredentials } from "./types.js";

const AZTEC_API_KEY_HEADER = "X-Aztec-API-Key";
const DEFAULT_ACCOUNT_SALT = new Fr(0);
const POLL_MS = 5_000;

export type BrowserClaimProgress =
  | "wallet"
  | "account"
  | "l2-wait"
  | "l2-claim"
  | "done";

type NodeClient = ReturnType<typeof createAztecNodeClient>;

type WarmEntry = {
  key: string;
  node: NodeClient;
  wallet: EmbeddedWallet;
};

let warm: WarmEntry | null = null;
let warming: Promise<WarmEntry> | null = null;

function parseSalt(raw?: string): Fr {
  if (!raw?.trim()) return DEFAULT_ACCOUNT_SALT;
  return Fr.fromHexString(raw.trim());
}

function cacheKey(networkId: string, aztecNodeUrl: string, apiKey?: string): string {
  return `${networkId}|${aztecNodeUrl.trim()}|${apiKey?.trim() ?? ""}`;
}

function createBrowserNode(url: string, apiKey?: string) {
  const fetchFn = apiKey
    ? (host: string, body: unknown, extraHeaders: Record<string, string> = {}, noRetry = false) =>
        defaultFetch(host, body, { ...extraHeaders, [AZTEC_API_KEY_HEADER]: apiKey }, noRetry)
    : undefined;
  return createAztecNodeClient(url, undefined, fetchFn);
}

async function registerAccount(wallet: EmbeddedWallet, secret: Fr, salt: Fr) {
  const signingKey = deriveMasterMessageSigningSecretKey(secret);
  return wallet.createSchnorrInitializerlessAccount(secret, salt, signingKey, "main");
}

async function claimWithBootstrap(wallet: Wallet, caller: AztecAddress, claim: ClaimCredentials) {
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(caller, {
    claimAmount: BigInt(claim.claimAmount),
    claimSecret: Fr.fromHexString(claim.claimSecret),
    messageLeafIndex: BigInt(claim.messageLeafIndex),
  });
  // Bootstrap only — claim runs inside the fee payment path.
  const executionPayload = await paymentMethod.getExecutionPayload();
  return wallet.sendTx(executionPayload, { from: caller });
}

async function waitForMessage(node: NodeClient, messageHash: Fr, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isL1ToL2MessageReady(node, messageHash)) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for L1→L2 message ${messageHash.toString()}`);
}

async function createWarmEntry(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
}): Promise<WarmEntry> {
  const key = cacheKey(params.networkId, params.aztecNodeUrl, params.apiKey);
  const node = createBrowserNode(params.aztecNodeUrl, params.apiKey);
  const proverEnabled = params.networkId !== "local";
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled },
  });
  return { key, node, wallet };
}

/**
 * Prefetch + initialize EmbeddedWallet / PXE so claim does not stall later.
 * Safe to call multiple times — caches by networkId + node URL.
 */
export async function warmupBrowserClaim(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
  onProgress?: (detail: string) => void;
}): Promise<void> {
  const key = cacheKey(params.networkId, params.aztecNodeUrl, params.apiKey);
  if (warm?.key === key) {
    params.onProgress?.("PXE already ready");
    return;
  }

  if (warming) {
    params.onProgress?.("PXE warmup already in progress…");
    const entry = await warming;
    if (entry.key === key) return;
    // Different target — fall through and start a new warmup.
  }

  params.onProgress?.("Initializing EmbeddedWallet / PXE (large first-time download)…");
  const run = createWarmEntry(params);
  warming = run;
  try {
    warm = await run;
  } finally {
    if (warming === run) warming = null;
  }
}

async function getOrCreateWarmEntry(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
}): Promise<WarmEntry> {
  const key = cacheKey(params.networkId, params.aztecNodeUrl, params.apiKey);
  if (warm?.key === key) {
    params.onProgress?.("wallet", "Using preloaded EmbeddedWallet / PXE…");
    return warm;
  }

  params.onProgress?.(
    "wallet",
    "Loading browser EmbeddedWallet / PXE (large download on first use — can take minutes)…",
  );

  if (warming) {
    const entry = await warming;
    if (entry.key === key) {
      warm = entry;
      return entry;
    }
  }

  const run = createWarmEntry(params);
  warming = run;
  try {
    warm = await run;
    return warm;
  } finally {
    if (warming === run) warming = null;
  }
}

/**
 * Wait for the L1→L2 message, then claim Fee Juice in the browser PXE.
 * Prefer calling `warmupBrowserClaim` during app boot so this is fast.
 */
export async function waitAndClaimInBrowser(params: {
  aztecNodeUrl: string;
  apiKey?: string;
  /** Network id — used to toggle prover (local = off). */
  networkId: string;
  credentials: ClaimCredentials;
  l2SecretKey: string;
  salt?: string;
  timeoutMs?: number;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
}): Promise<{ l2TxHash: string }> {
  const progress = params.onProgress ?? (() => {});
  const secret = Fr.fromHexString(params.l2SecretKey);
  const salt = parseSalt(params.salt);

  const { node, wallet } = await getOrCreateWarmEntry({
    aztecNodeUrl: params.aztecNodeUrl,
    networkId: params.networkId,
    apiKey: params.apiKey,
    onProgress: progress,
  });

  progress("account", "Registering claimer account…");
  await registerAccount(wallet, secret, salt);
  const caller = AztecAddress.fromStringUnsafe(params.credentials.recipient);

  progress(
    "l2-wait",
    "Waiting for L1→L2 message (Aztec may take several minutes after the L1 tx)…",
  );
  await waitForMessage(
    node,
    Fr.fromHexString(params.credentials.messageHash),
    params.timeoutMs ?? 30 * 60_000,
  );

  progress("l2-claim", "Claiming Fee Juice on L2 (proving in browser)…");
  const result = await claimWithBootstrap(wallet, caller, params.credentials);
  const l2TxHash = result.receipt.txHash.toString();
  progress("done", `L2 tx ${l2TxHash}`);
  return { l2TxHash };
}
