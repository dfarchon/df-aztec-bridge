/**
 * Browser L2 claim (EmbeddedWallet + PXE). Heavy — load via dynamic import only.
 */
import { createAztecNodeClient, waitForTx } from "@aztec/aztec.js/node";
import { NO_WAIT } from "@aztec/aztec.js/contracts";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { Fr, Fq } from "@aztec/foundation/curves/bn254";
import { defaultFetch } from "@aztec/foundation/json-rpc/client";
import { openTmpStore } from "@aztec/kv-store/sqlite-opfs";
import { getPXEConfig } from "@aztec/pxe/config";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { deriveMasterMessageSigningSecretKey } from "@aztec/stdlib/keys";
import { getNonNullifiedL1ToL2MessageWitness } from "@aztec/stdlib/messaging";
import { TxHash, TxStatus } from "@aztec/stdlib/tx";
import { EmbeddedWallet } from "@aztec/wallets/embedded";

import {
  assertL2ClaimReceiptOk,
  classifyWitnessLookupError,
  sendClaimThenWait,
  type ClaimMessageStatus,
} from "./claim-status.ts";
import { trimOversizedCrsCache } from "./crs-cache.ts";
import type { ClaimCredentials } from "./types.ts";

const AZTEC_API_KEY_HEADER = "X-Aztec-API-Key";
const DEFAULT_ACCOUNT_SALT = new Fr(0);
const POLL_MS = 5_000;

export type BrowserClaimProgress =
  | "wallet"
  | "account"
  | "l2-wait"
  | "l2-claim"
  | "l2-sent"
  | "done";

export type { ClaimMessageStatus };

type NodeClient = ReturnType<typeof createAztecNodeClient>;

type WarmEntry = {
  key: string;
  node: NodeClient;
  wallet: EmbeddedWallet;
};

let warm: WarmEntry | null = null;
let inFlight: { key: string; promise: Promise<WarmEntry> } | null = null;

function parseSalt(raw?: string): Fr {
  if (!raw?.trim()) return DEFAULT_ACCOUNT_SALT;
  return Fr.fromHexString(raw.trim());
}

/** Schnorr signing key: explicit hex from account file, else derive from secret (CLI convention). */
function resolveSigningKey(secret: Fr, signingKeyHex?: string): Fq {
  if (signingKeyHex?.trim()) {
    return Fq.fromHexString(signingKeyHex.trim());
  }
  return deriveMasterMessageSigningSecretKey(secret);
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

async function registerAccount(
  wallet: EmbeddedWallet,
  secret: Fr,
  salt: Fr,
  signingKeyHex?: string,
) {
  const signingKey = resolveSigningKey(secret, signingKeyHex);
  return wallet.createSchnorrInitializerlessAccount(secret, salt, signingKey, "main");
}

async function sendClaimTx(wallet: Wallet, caller: AztecAddress, claim: ClaimCredentials) {
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(caller, {
    claimAmount: BigInt(claim.claimAmount),
    claimSecret: Fr.fromHexString(claim.claimSecret),
    messageLeafIndex: BigInt(claim.messageLeafIndex),
  });
  const executionPayload = await paymentMethod.getExecutionPayload();
  return wallet.sendTx(executionPayload, { from: caller, wait: NO_WAIT });
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

  // Runs before the lazy prover touches the CRS on the first proof.
  if (proverEnabled) await trimOversizedCrsCache();

  // `ephemeral` only covers the wallet DB — createPXE otherwise always opens the
  // fixed-name `pxe_data` OPFS store, whose exclusive sync access handle makes a
  // second PXE (other tab, retry after a failed warmup) fail to start. Claiming
  // needs no state across sessions, so inject an in-memory store instead.
  const store = await openTmpStore(true);
  try {
    const wallet = await EmbeddedWallet.create(node, {
      ephemeral: true,
      pxe: { ...getPXEConfig(), proverEnabled, store },
    });
    return { key, node, wallet };
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}

async function stopWarmEntry(entry: WarmEntry): Promise<void> {
  try {
    await entry.wallet.stop();
  } catch (error) {
    console.warn("[claim] Failed to stop EmbeddedWallet cleanly", error);
  }
}

/**
 * PXE holds an exclusive OPFS sync access handle on its sqlite file, so a second
 * EmbeddedWallet cannot be created until the previous one has been stopped.
 * Boot warmup, the network-change warmup and the claim itself all funnel through
 * here so those creations are serialized rather than overlapping.
 */
function ensureWarmEntry(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
}): Promise<WarmEntry> {
  const key = cacheKey(params.networkId, params.aztecNodeUrl, params.apiKey);
  if (warm?.key === key) return Promise.resolve(warm);
  if (inFlight?.key === key) return inFlight.promise;

  const previous = inFlight?.promise;
  const promise = (async () => {
    if (previous) await previous.catch(() => undefined);
    if (warm?.key === key) return warm;

    if (warm) {
      const stale = warm;
      warm = null;
      await stopWarmEntry(stale);
    }

    const entry = await createWarmEntry(params);
    warm = entry;
    return entry;
  })();

  const record = { key, promise };
  inFlight = record;
  void promise
    .catch(() => undefined)
    .finally(() => {
      if (inFlight === record) inFlight = null;
    });

  return promise;
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

  params.onProgress?.(
    inFlight
      ? "PXE warmup already in progress…"
      : "Initializing EmbeddedWallet / PXE (large first-time download)…",
  );
  await ensureWarmEntry(params);
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
  return ensureWarmEntry(params);
}

export async function getClaimMessageStatus(params: {
  aztecNodeUrl: string;
  apiKey?: string;
  credentials: Pick<ClaimCredentials, "messageHash" | "claimSecret">;
}): Promise<ClaimMessageStatus> {
  const node = createBrowserNode(params.aztecNodeUrl, params.apiKey);
  const messageHash = Fr.fromHexString(params.credentials.messageHash);
  const secret = Fr.fromHexString(params.credentials.claimSecret);

  if (!(await isL1ToL2MessageReady(node, messageHash))) {
    return "l2-sync-pending";
  }

  try {
    await getNonNullifiedL1ToL2MessageWitness(
      node,
      ProtocolContractAddress.FeeJuice,
      messageHash,
      secret,
    );
    return "ready";
  } catch (error) {
    if (classifyWitnessLookupError(error) === "consumed") return "consumed";
    throw error;
  }
}

/**
 * Public Fee Juice balance for an Aztec address (PXE / L2 wallet).
 * Reads protocol Fee Juice public storage via the Aztec node — no PXE required.
 */
export async function getAztecFeeJuiceBalance(params: {
  aztecNodeUrl: string;
  apiKey?: string;
  aztecAddress: string;
}): Promise<bigint> {
  const { getFeeJuiceBalance } = await import("@aztec/aztec.js/utils");
  const node = createBrowserNode(params.aztecNodeUrl, params.apiKey);
  const owner = AztecAddress.fromStringUnsafe(params.aztecAddress.trim());
  return getFeeJuiceBalance(owner, node);
}

export async function waitForL2ClaimTx(params: {
  aztecNodeUrl: string;
  apiKey?: string;
  l2TxHash: string;
  timeoutSeconds?: number;
}): Promise<{ l2TxHash: string; status: string }> {
  const node = createBrowserNode(params.aztecNodeUrl, params.apiKey);
  const txHash = TxHash.fromString(params.l2TxHash);
  const receipt = await waitForTx(node, txHash, {
    waitForStatus: TxStatus.PROPOSED,
    timeout: params.timeoutSeconds ?? 30 * 60,
    interval: 5,
    dontThrowOnRevert: true,
  });

  return assertL2ClaimReceiptOk(receipt, params.l2TxHash);
}

/**
 * Wait for the L1→L2 message, then claim Fee Juice in the browser PXE.
 * Prefer calling `warmupBrowserClaim` during app boot so this is fast.
 *
 * Uses `wait: NO_WAIT` so callers can persist the L2 tx hash immediately after
 * proving/submission and before mining completes.
 */
export async function waitAndClaimInBrowser(params: {
  aztecNodeUrl: string;
  apiKey?: string;
  /** Network id — used to toggle prover (local = off). */
  networkId: string;
  credentials: ClaimCredentials;
  l2SecretKey: string;
  salt?: string;
  /**
   * Schnorr signing key hex. Required for accounts that used an independent
   * signing key (e.g. dfpunk). Omit to derive from secret (CLI / aztec-kit convention).
   */
  signingKey?: string;
  timeoutMs?: number;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
  /** Fired as soon as the L2 claim tx hash is known (after prove + submit). */
  onTxSent?: (l2TxHash: string) => void;
}): Promise<{ l2TxHash: string }> {
  const progress = params.onProgress ?? (() => {});
  const secret = Fr.fromHexString(params.l2SecretKey);
  const salt = parseSalt(params.salt);

  const messageStatus = await getClaimMessageStatus({
    aztecNodeUrl: params.aztecNodeUrl,
    apiKey: params.apiKey,
    credentials: params.credentials,
  });
  if (messageStatus === "consumed") {
    progress("done", "Claim message already consumed — nothing to do");
    return { l2TxHash: "" };
  }

  const { node, wallet } = await getOrCreateWarmEntry({
    aztecNodeUrl: params.aztecNodeUrl,
    networkId: params.networkId,
    apiKey: params.apiKey,
    onProgress: progress,
  });

  progress("account", "Registering claimer account…");
  const manager = await registerAccount(wallet, secret, salt, params.signingKey);
  const expected = AztecAddress.fromStringUnsafe(params.credentials.recipient);
  if (!manager.address.equals(expected)) {
    throw new Error(
      `Registered account ${manager.address} does not match claim recipient ${expected}. ` +
        `Wrong salt/signingKey — for dfpunk accounts pass the file's signingKey (do not derive from secret).`,
    );
  }

  if (messageStatus === "l2-sync-pending") {
    progress(
      "l2-wait",
      "Waiting for L1→L2 message (Aztec may take several minutes after the L1 tx)…",
    );
    await waitForMessage(
      node,
      Fr.fromHexString(params.credentials.messageHash),
      params.timeoutMs ?? 30 * 60_000,
    );
  }

  const afterWait = await getClaimMessageStatus({
    aztecNodeUrl: params.aztecNodeUrl,
    apiKey: params.apiKey,
    credentials: params.credentials,
  });
  if (afterWait === "consumed") {
    progress("done", "Claim message already consumed — nothing to do");
    return { l2TxHash: "" };
  }

  progress("l2-claim", "Proving and submitting Fee Juice claim on L2…");
  const { l2TxHash } = await sendClaimThenWait({
    send: async () => {
      const { txHash } = await sendClaimTx(wallet, manager.address, params.credentials);
      return { txHash: txHash.toString() };
    },
    onTxSent: (hash) => {
      params.onTxSent?.(hash);
      progress("l2-sent", `L2 claim submitted — ${hash}`);
    },
    wait: async (hash) => {
      progress("l2-claim", "Waiting for L2 claim confirmation…");
      await waitForL2ClaimTx({
        aztecNodeUrl: params.aztecNodeUrl,
        apiKey: params.apiKey,
        l2TxHash: hash,
        timeoutSeconds: Math.ceil((params.timeoutMs ?? 30 * 60_000) / 1000),
      });
    },
  });
  progress("done", `L2 tx ${l2TxHash}`);
  return { l2TxHash };
}

/** dfpunk-compatible Schnorr account created in-browser via EmbeddedWallet / PXE. */
export interface QuickDfpunkAccount {
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  createdAt: number;
  label: string;
}

/**
 * Create a quick Aztec wallet (same credential shape as dfpunk-account-*.json).
 * Uses the warmed EmbeddedWallet / PXE when available.
 */
export async function createQuickDfpunkAccount(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
  label?: string;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
}): Promise<QuickDfpunkAccount> {
  const { wallet } = await getOrCreateWarmEntry(params);
  params.onProgress?.("account", "Generating Schnorr keys (dfpunk-compatible)…");

  const secretKey = Fr.random();
  const salt = Fr.random();
  const signingKey = Fq.random();

  const manager = await wallet.createSchnorrInitializerlessAccount(
    secretKey,
    salt,
    signingKey,
    "main",
  );

  return {
    address: manager.address.toString(),
    secretKey: secretKey.toString(),
    salt: salt.toString(),
    signingKey: signingKey.toString(),
    createdAt: Date.now(),
    label: params.label?.trim() || "dfpunk quick wallet",
  };
}

/**
 * Register an existing dfpunk / DF client account into the browser EmbeddedWallet PXE.
 * Required before L2 claim when the account was created outside this DApp.
 */
export async function importDfpunkAccountIntoPxe(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
  address: string;
  secretKey: string;
  salt: string;
  /** Required for dfpunk accounts (independent Grumpkin signing key). */
  signingKey: string;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
}): Promise<{ address: string }> {
  if (!params.signingKey?.trim()) {
    throw new Error(
      "DF client accounts require signingKey. Download dfpunk-account-*.json from the DF game (Settings / Download account info).",
    );
  }
  const { wallet } = await getOrCreateWarmEntry(params);
  params.onProgress?.("account", "Registering DF / dfpunk account in browser PXE…");

  const secret = Fr.fromHexString(params.secretKey.trim());
  const salt = Fr.fromHexString(params.salt.trim());
  const signingKey = resolveSigningKey(secret, params.signingKey);
  const manager = await wallet.createSchnorrInitializerlessAccount(
    secret,
    salt,
    signingKey,
    "main",
  );

  const derived = manager.address.toString().toLowerCase();
  const expected = params.address.trim().toLowerCase();
  if (derived !== expected) {
    throw new Error(
      `Imported keys derive ${manager.address.toString()}, but the file says ${params.address}. Check secretKey / salt / signingKey from the DF client export.`,
    );
  }

  params.onProgress?.("account", `PXE registered ${manager.address.toString()}`);
  return { address: manager.address.toString() };
}
