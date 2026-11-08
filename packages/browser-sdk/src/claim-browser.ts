/**
 * Browser L2 claim (EmbeddedWallet + PXE). Heavy — load via dynamic import only.
 */
import { createAztecNodeClient, waitForTx } from "@aztec-labs/aztec.js/node";
import { NO_WAIT } from "@aztec-labs/aztec.js/contracts";
import { FeeJuicePaymentMethodWithClaim } from "@aztec-labs/aztec.js/fee";
import { isL1ToL2MessageReady } from "@aztec-labs/aztec.js/messaging";
import { ProtocolContractAddress } from "@aztec-labs/aztec.js/protocol";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
import { Fr, Fq } from "@aztec-labs/foundation/curves/bn254";
import { defaultFetch } from "@aztec-labs/foundation/json-rpc/client";
import { openTmpStore } from "@aztec-labs/kv-store/sqlite-opfs";
import { getPXEConfig } from "@aztec-labs/pxe/config";
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address";
import { deriveMasterMessageSigningSecretKey } from "@aztec-labs/stdlib/keys";
import { getNonNullifiedL1ToL2MessageWitness } from "@aztec-labs/stdlib/messaging";
import { TxHash, TxStatus } from "@aztec-labs/stdlib/tx";
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded";

import {
  assertL2ClaimReceiptOk,
  classifyWitnessLookupError,
  sendClaimThenWait,
  type ClaimMessageStatus,
} from "./claim-status.ts";
import { trimOversizedCrsCache } from "./crs-cache.ts";
import { isDrpcRpcHost, rewriteAztecRpcMethodsForDrpc } from "./drpc-rpc.ts";
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

type SchnorrAccountStyle = "schnorr_initializerless" | "schnorr";

/** Result of matching account keys to an address on Aztec 6.0. */
export type AztecWalletCompat =
  | "v6-initializerless"
  | "v6-schnorr"
  | "pre-v6"
  | "unknown";

/** Signing-key candidates: file key first (DF), then secret-derived (older CLI). */
function signingKeyCandidates(secret: Fr, signingKeyHex?: string): { label: string; key: Fq }[] {
  const derived = deriveMasterMessageSigningSecretKey(secret);
  if (!signingKeyHex?.trim()) {
    return [{ label: "derived", key: derived }];
  }
  const fromFile = Fq.fromHexString(signingKeyHex.trim());
  if (fromFile.equals(derived)) {
    return [{ label: "file", key: fromFile }];
  }
  return [
    { label: "file", key: fromFile },
    { label: "derived", key: derived },
  ];
}

function compatFromStyle(style: SchnorrAccountStyle): Exclude<AztecWalletCompat, "pre-v6" | "unknown"> {
  return style === "schnorr" ? "v6-schnorr" : "v6-initializerless";
}

function cacheKey(networkId: string, aztecNodeUrl: string, apiKey?: string): string {
  return `${networkId}|${aztecNodeUrl.trim()}|${apiKey?.trim() ?? ""}`;
}

function createBrowserNode(url: string, apiKey?: string) {
  const fetchFn = (
    host: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    noRetry = false,
  ) => {
    const payload =
      isDrpcRpcHost(host) || isDrpcRpcHost(url) ? rewriteAztecRpcMethodsForDrpc(body) : body;
    const headers = apiKey
      ? { ...extraHeaders, [AZTEC_API_KEY_HEADER]: apiKey }
      : extraHeaders;
    return defaultFetch(host, payload, headers, noRetry);
  };
  return createAztecNodeClient(url, { fetch: fetchFn });
}

function logRegister(step: string, detail: Record<string, unknown>) {
  // Vite production builds drop console; keep quiet unless DEV is explicitly true.
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (env?.DEV !== true) return;
  console.info(`[claim][register] ${step}`, detail);
}

type RegisterAccountResult = {
  manager: Awaited<ReturnType<EmbeddedWallet["createSchnorrInitializerlessAccount"]>>;
  style: SchnorrAccountStyle;
  compat: Exclude<AztecWalletCompat, "pre-v6" | "unknown">;
};

/**
 * Register a DF / Aztec Schnorr account into the EmbeddedWallet PXE.
 * New wallets (no expected address): Schnorr initializerless only (current DF Punk).
 * Import / claim (expected address set): try initializerless first, then Schnorr-with-init
 * and alternate signing-key derivation until the address matches — older DF / CLI backups
 * often used createSchnorrAccount instead of initializerless.
 */
async function registerAccount(
  wallet: EmbeddedWallet,
  secret: Fr,
  salt: Fr,
  signingKeyHex: string | undefined,
  expected?: AztecAddress,
): Promise<RegisterAccountResult> {
  const expectedAddress = expected?.toString() ?? null;
  const signingKeys = signingKeyCandidates(secret, signingKeyHex);
  // Prefer current DF Punk style; fall back to Schnorr-with-init for older backups.
  const styles: SchnorrAccountStyle[] = expected
    ? ["schnorr_initializerless", "schnorr"]
    : ["schnorr_initializerless"];

  logRegister("1-start", {
    sdk: "6.0.0",
    expected: expectedAddress,
    signingKeyFromFile: Boolean(signingKeyHex?.trim()),
    styles,
    signingCandidates: signingKeys.map((s) => s.label),
  });

  const attempts: { style: SchnorrAccountStyle; signing: string; derived: string }[] = [];

  for (const signing of signingKeys) {
    for (const style of styles) {
      const manager =
        style === "schnorr"
          ? await wallet.createSchnorrAccount(secret, salt, signing.key, "main")
          : await wallet.createSchnorrInitializerlessAccount(secret, salt, signing.key, "main");
      const derived = manager.address.toString();
      const match = expected ? manager.address.equals(expected) : true;
      attempts.push({ style, signing: signing.label, derived });
      logRegister("2-attempt", { style, signing: signing.label, derived, expected: expectedAddress, match });
      if (match) {
        logRegister("3-ok", { address: derived, style, signing: signing.label });
        return { manager, style, compat: compatFromStyle(style) };
      }
    }
  }

  const attemptSummary = attempts
    .map((a) => `${a.style}/${a.signing}→${a.derived}`)
    .join("; ");
  throw new Error(
    `These keys do not recreate address ${expectedAddress} on Aztec 6.0 ` +
      `(tried Schnorr initializerless and Schnorr-with-init). Attempts: ${attemptSummary}. ` +
      `If this backup is from Aztec v5 or v5.1, the same keys can be checked for a new 6.0 address. ` +
      `Funds already sent to ${expectedAddress} stay at that address.`,
  );
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
    "Loading browser EmbeddedWallet / PXE. Large download on first use. Can take minutes…",
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
  const { getFeeJuiceBalance } = await import("@aztec-labs/aztec.js/utils");
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
    progress("done", "Claim message already consumed. Nothing to do.");
    return { l2TxHash: "" };
  }

  const { node, wallet } = await getOrCreateWarmEntry({
    aztecNodeUrl: params.aztecNodeUrl,
    networkId: params.networkId,
    apiKey: params.apiKey,
    onProgress: progress,
  });

  progress("account", "Registering claimer account…");
  const expected = AztecAddress.fromStringUnsafe(params.credentials.recipient);
  logRegister("0-claim-inputs", {
    recipient: params.credentials.recipient,
    signingKeyPresent: Boolean(params.signingKey?.trim()),
  });
  const { manager, compat } = await registerAccount(
    wallet,
    secret,
    salt,
    params.signingKey,
    expected,
  );
  logRegister("0-claim-compat", { compat });

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
    progress("done", "Claim message already consumed. Nothing to do.");
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
      progress("l2-sent", `L2 claim submitted. ${hash}`);
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

/**
 * Claim through an already-connected external Aztec wallet (Nulo).
 * The wallet holds the account keys and proves the transaction itself.
 */
export async function claimUsingExternalWallet(params: {
  wallet: Wallet;
  from: AztecAddress;
  aztecNodeUrl: string;
  apiKey?: string;
  credentials: ClaimCredentials;
  timeoutMs?: number;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
  onTxSent?: (l2TxHash: string) => void;
}): Promise<{ l2TxHash: string }> {
  const progress = params.onProgress ?? (() => {});
  if (params.from.toString().toLowerCase() !== params.credentials.recipient.toLowerCase()) {
    throw new Error("The connected Aztec wallet does not match this claim recipient.");
  }

  const messageStatus = await getClaimMessageStatus({
    aztecNodeUrl: params.aztecNodeUrl,
    apiKey: params.apiKey,
    credentials: params.credentials,
  });
  if (messageStatus === "consumed") {
    progress("done", "Claim message already consumed. Nothing to do.");
    return { l2TxHash: "" };
  }

  const node = createBrowserNode(params.aztecNodeUrl, params.apiKey);
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
    progress("done", "Claim message already consumed. Nothing to do.");
    return { l2TxHash: "" };
  }

  progress("l2-claim", "Asking the connected Aztec wallet to prove and submit the claim…");
  const { l2TxHash } = await sendClaimThenWait({
    send: async () => {
      const { txHash } = await sendClaimTx(params.wallet, params.from, params.credentials);
      return { txHash: txHash.toString() };
    },
    onTxSent: (hash) => {
      params.onTxSent?.(hash);
      progress("l2-sent", `L2 claim submitted. ${hash}`);
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

/** DF Punk–compatible Schnorr initializerless account created in-browser via EmbeddedWallet / PXE. */
export interface QuickDfpunkAccount {
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  createdAt: number;
  label: string;
  walletCompat: "v6-initializerless";
}

/**
 * Create a DF Aztec wallet (same credential shape as dfpunk-account-*.json).
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
  params.onProgress?.("account", "Generating Schnorr initializerless keys (DF Punk)…");

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
    label: params.label?.trim() || "DF Aztec account",
    walletCompat: "v6-initializerless",
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
}): Promise<{ address: string; walletCompat: AztecWalletCompat }> {
  if (!params.signingKey?.trim()) {
    throw new Error(
      "DF client accounts require signingKey. Download dfpunk-account-*.json from the DF game (Settings / Download account info).",
    );
  }
  const { wallet } = await getOrCreateWarmEntry(params);
  params.onProgress?.("account", "Registering DF / dfpunk account in browser PXE…");

  const secret = Fr.fromHexString(params.secretKey.trim());
  const salt = Fr.fromHexString(params.salt.trim());
  const { manager, compat } = await registerAccount(
    wallet,
    secret,
    salt,
    params.signingKey,
    AztecAddress.fromStringUnsafe(params.address.trim()),
  );

  params.onProgress?.("account", `PXE registered ${manager.address.toString()} (${compat})`);
  return { address: manager.address.toString(), walletCompat: compat };
}

const AZTEC_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

/** Aztec 6.0 DF account derived from an older Schnorr backup. Keys are unchanged. */
export interface VerifiedV6DfpunkAccount {
  previousAddress: string;
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  walletCompat: "v6-initializerless";
}

/**
 * Derive the Aztec 6.0 DF address from a v5 / v5.1 Schnorr backup.
 * Uses the file signing key and Schnorr initializerless (current DF).
 * Returns only after a second registration reproduces that same address.
 */
export async function deriveVerifiedV6DfpunkAccount(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
}): Promise<VerifiedV6DfpunkAccount> {
  const signingKey = params.signingKey?.trim() ?? "";
  if (!signingKey) {
    throw new Error(
      "This backup has no signingKey. Download dfpunk-account-*.json from the DF game (Settings / Download account info).",
    );
  }
  const previousAddress = params.address.trim();
  const secretKey = params.secretKey.trim();
  const salt = params.salt.trim();
  if (!AZTEC_ADDRESS_RE.test(previousAddress)) {
    throw new Error("The backup address is not a 32-byte Aztec address.");
  }

  const { wallet } = await getOrCreateWarmEntry(params);
  params.onProgress?.("account", "Deriving the Aztec 6.0 address from these Schnorr keys…");
  const secret = Fr.fromHexString(secretKey);
  const saltFr = Fr.fromHexString(salt);
  const signing = Fq.fromHexString(signingKey);
  const manager = await wallet.createSchnorrInitializerlessAccount(secret, saltFr, signing, "main");
  const derived = manager.address.toString();
  if (!AZTEC_ADDRESS_RE.test(derived)) {
    throw new Error("Aztec 6.0 did not return a valid account address for these keys.");
  }
  if (manager.address.equals(AztecAddress.fromStringUnsafe(previousAddress))) {
    throw new Error("These keys already recreate this address on Aztec 6.0. Import the file as-is.");
  }

  params.onProgress?.("account", "Checking the new address matches these keys…");
  const checked = await registerAccount(
    wallet,
    secret,
    saltFr,
    signingKey,
    AztecAddress.fromStringUnsafe(derived),
  );
  if (
    checked.style !== "schnorr_initializerless" ||
    !checked.manager.address.equals(manager.address)
  ) {
    throw new Error("Aztec 6.0 validation failed. The derived address did not match these keys.");
  }

  return {
    previousAddress,
    address: checked.manager.address.toString(),
    secretKey,
    salt,
    signingKey,
    walletCompat: "v6-initializerless",
  };
}

/**
 * Classify whether account keys recreate `address` under Aztec 6.0 Schnorr styles.
 * Does not throw on mismatch — returns `pre-v6` (v5 / v5.1 era addresses).
 */
export async function classifyAztecWalletCompat(params: {
  aztecNodeUrl: string;
  networkId: string;
  apiKey?: string;
  address: string;
  secretKey: string;
  salt: string;
  signingKey?: string;
  onProgress?: (phase: BrowserClaimProgress, detail?: string) => void;
}): Promise<AztecWalletCompat> {
  if (!params.address.trim() || !params.secretKey.trim()) return "unknown";
  try {
    const { wallet } = await getOrCreateWarmEntry(params);
    params.onProgress?.("account", "Checking Aztec account version…");
    const secret = Fr.fromHexString(params.secretKey.trim());
    const salt = Fr.fromHexString(params.salt.trim() || "0x0");
    const { compat } = await registerAccount(
      wallet,
      secret,
      salt,
      params.signingKey,
      AztecAddress.fromStringUnsafe(params.address.trim()),
    );
    return compat;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (/do not recreate address|not an Aztec|5\.1|initializerless and Schnorr/i.test(message)) {
      return "pre-v6";
    }
    throw e;
  }
}
