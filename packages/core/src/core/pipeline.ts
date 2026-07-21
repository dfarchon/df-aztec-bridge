import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr, Fq } from "@aztec/foundation/curves/bn254";
import { deriveMasterMessageSigningSecretKey } from "@aztec/stdlib/keys";
import { getPXEConfig } from "@aztec/pxe/server";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { TxReceipt } from "@aztec/stdlib/tx";
import { parseUnits, type Hex } from "viem";

import { loadNetworkConfig, resolveL1Backend } from "../config/index.js";
import { waitForL1ToL2Message } from "./bridging.js";
import { claimWithBootstrap } from "./claim.js";
import { bridgeFeeJuiceOnL1 } from "./l1/index.js";
import { createNode } from "./node.js";
import type { BridgeJobResult, ClaimCredentials, NetworkConfig, RuntimeSecrets, L1Backend } from "./types.js";

const ANVIL_DEV_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** Default salt for initializerless accounts — keeps address recoverable from secret alone. */
export const DEFAULT_ACCOUNT_SALT = new Fr(0);

function isTransientAztecNodeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err && typeof err === "object" && "cause" in err
      ? String((err as { cause?: { message?: string; code?: number } }).cause?.message ?? "")
      : "";
  const causeCode =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause?: { code?: number } }).cause?.code
      : undefined;
  return (
    causeCode === 19 ||
    msg.includes("Temporary internal error") ||
    msg.includes("Please retry") ||
    causeMsg.includes("Temporary internal error") ||
    causeMsg.includes("Please retry")
  );
}

/** Drop Aztec SDK ERROR dumps for known-transient RPC failures (we retry ourselves). */
let transientStderrDepth = 0;
let transientStderrOriginal: typeof process.stderr.write | null = null;
let transientStderrRestoreTimer: ReturnType<typeof setTimeout> | null = null;
let transientStderrSwallowing = false;

function suppressTransientAztecStderr(): () => void {
  if (transientStderrRestoreTimer) {
    clearTimeout(transientStderrRestoreTimer);
    transientStderrRestoreTimer = null;
  }

  if (transientStderrDepth === 0) {
    const originalWrite = process.stderr.write.bind(process.stderr);
    transientStderrOriginal = originalWrite;
    transientStderrSwallowing = false;

    process.stderr.write = ((
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((err?: Error) => void),
      cb?: (err?: Error) => void,
    ) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (
        text.includes("Temporary internal error") ||
        text.includes("Please retry, trace-id") ||
        (text.includes("ERROR:") &&
          text.includes("embedded-wallet") &&
          (text.includes("Please retry") || text.includes("Temporary internal error")))
      ) {
        transientStderrSwallowing = true;
        if (typeof encoding === "function") encoding();
        else if (cb) cb();
        return true;
      }
      if (transientStderrSwallowing) {
        const trimmed = text.trim();
        if (
          /^\s*at\s+/.test(text) ||
          trimmed.startsWith("[cause]") ||
          trimmed.startsWith("message:") ||
          trimmed.startsWith("code:") ||
          trimmed === "{" ||
          trimmed === "}" ||
          trimmed === "}," ||
          trimmed.endsWith("{") ||
          /node_modules\/\.pnpm\/@aztec/.test(text)
        ) {
          if (typeof encoding === "function") encoding();
          else if (cb) cb();
          return true;
        }
        transientStderrSwallowing = false;
      }
      return originalWrite(chunk as never, encoding as never, cb as never);
    }) as typeof process.stderr.write;
  }

  transientStderrDepth += 1;

  return () => {
    transientStderrDepth = Math.max(0, transientStderrDepth - 1);
    if (transientStderrDepth > 0 || !transientStderrOriginal) return;
    // Delay restore so late async ERROR dumps after a successful retry don't flash.
    const original = transientStderrOriginal;
    transientStderrRestoreTimer = setTimeout(() => {
      process.stderr.write = original;
      transientStderrOriginal = null;
      transientStderrRestoreTimer = null;
      transientStderrSwallowing = false;
    }, 400);
  };
}

async function withAztecNodeRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    attempts?: number;
    onRetry?: (attempt: number, err: unknown) => void;
    onRecovered?: (retries: number) => void;
  },
): Promise<T> {
  const attempts = opts?.attempts ?? 4;
  const restoreStderr = suppressTransientAztecStderr();
  let last: unknown;
  let retries = 0;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const value = await fn();
        if (retries > 0) opts?.onRecovered?.(retries);
        return value;
      } catch (err) {
        last = err;
        if (!isTransientAztecNodeError(err) || attempt === attempts) throw err;
        retries = attempt;
        opts?.onRetry?.(attempt, err);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  } finally {
    restoreStderr();
  }
}

async function registerInitializerlessAccount(
  wallet: EmbeddedWallet,
  secret: Fr,
  salt: Fr = DEFAULT_ACCOUNT_SALT,
  signingKeyHex?: string,
) {
  const signingKey = signingKeyHex?.trim()
    ? Fq.fromHexString(signingKeyHex.trim())
    : deriveMasterMessageSigningSecretKey(secret);
  return wallet.createSchnorrInitializerlessAccount(secret, salt, signingKey, "main");
}

function parseAccountSalt(raw?: string, randomSalt?: boolean): Fr {
  if (randomSalt && raw?.trim()) {
    throw new Error("Pass either --salt <hex> or --random-salt, not both.");
  }
  if (randomSalt) return Fr.random();
  if (!raw?.trim()) return DEFAULT_ACCOUNT_SALT;
  return Fr.fromHexString(raw.trim());
}

function txHashFromSendResult(result: { receipt: TxReceipt }) {
  return result.receipt.txHash.toString();
}

export interface CreateAztecAccountOptions {
  networkId: string;
  /** Optional fixed L2 secret; random if omitted. */
  l2SecretKey?: string;
  /** Optional salt hex; defaults to 0 so address is recoverable from secret alone. */
  salt?: string;
  /** If true, generate a random salt (mutually exclusive with salt). */
  randomSalt?: boolean;
  secrets?: RuntimeSecrets;
  onProgress?: (phase: string, detail?: string) => void;
}

export interface CreatedAztecAccount {
  networkId: string;
  aztecAddress: string;
  l2SecretKey: string;
  salt: string;
}

/** Create (register) an initializerless Schnorr Aztec account. No L1 bridge. */
export async function createAztecAccount(
  opts: CreateAztecAccountOptions,
): Promise<CreatedAztecAccount> {
  const network = loadNetworkConfig(opts.networkId);
  const secrets = opts.secrets ?? {};
  const apiKey = secrets.aztecApiKey ?? network.apiKey;
  const progress = opts.onProgress ?? (() => {});

  progress("wallet", "Opening ephemeral Aztec wallet");
  const { wallet } = await withAztecNodeRetry(() => openWallet(network, apiKey), {
    onRetry: (attempt) => {
      progress("wallet", `Aztec RPC temporary error — retrying (${attempt}/3)…`);
    },
    onRecovered: (retries) => {
      progress("wallet", `Wallet ready (recovered after ${retries} retry)`);
    },
  });

  const secret = opts.l2SecretKey ? Fr.fromHexString(opts.l2SecretKey) : Fr.random();
  const salt = parseAccountSalt(opts.salt, opts.randomSalt);

  progress("account", "Creating initializerless Aztec account");
  const manager = await withAztecNodeRetry(
    () => registerInitializerlessAccount(wallet, secret, salt),
    {
      onRetry: (attempt) => {
        progress("account", `Aztec RPC temporary error — retrying (${attempt}/3)…`);
      },
      onRecovered: (retries) => {
        progress("account", `Account ready (recovered after ${retries} retry)`);
      },
    },
  );

  progress("done", manager.address.toString());

  return {
    networkId: network.id,
    aztecAddress: manager.address.toString(),
    l2SecretKey: secret.toString(),
    salt: salt.toString(),
  };
}

export interface RunBridgePipelineOptions {
  networkId: string;
  /** Human-readable FJ amount (18 decimals). Ignored when faucet mints a fixed amount. */
  amountFj: string;
  /** Bridge to this Aztec address. Required when createAccount is false. */
  recipient?: string;
  /** Create a fresh initializerless account, bridge to it, and claim. */
  createAccount?: boolean;
  /** L2 secret key (Fr hex). When set, loads that account instead of creating one. */
  l2SecretKey?: string;
  /** Account salt (hex). Defaults to 0. */
  salt?: string;
  /** If true, generate a random salt (mutually exclusive with salt). */
  randomSalt?: boolean;
  l1Backend?: L1Backend;
  secrets?: RuntimeSecrets;
  onProgress?: (phase: string, detail?: string) => void;
}

async function executeL1Bridge(
  network: NetworkConfig,
  node: ReturnType<typeof createNode>,
  recipientAddress: AztecAddress,
  amountWei: bigint,
  l1Key: Hex,
  l1Backend: L1Backend,
) {
  return bridgeFeeJuiceOnL1({
    network,
    node,
    recipient: recipientAddress,
    amount: amountWei,
    l1PrivateKey: l1Key,
    backend: l1Backend,
  });
}

function resolveL1Key(network: NetworkConfig, secrets: RuntimeSecrets): Hex {
  if (secrets.l1PrivateKey) return secrets.l1PrivateKey;
  if (network.id === "local") return ANVIL_DEV_KEY;
  throw new Error("L1_PRIVATE_KEY is required for testnet/mainnet (or pass --l1-key / API body).");
}

async function openWallet(network: NetworkConfig, apiKey?: string) {
  const node = createNode(network.aztecNodeUrl, apiKey);
  const proverEnabled = network.id !== "local";
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled },
  });
  return { node, wallet };
}

export async function runBridgePipeline(opts: RunBridgePipelineOptions): Promise<BridgeJobResult> {
  const network = loadNetworkConfig(opts.networkId);
  const secrets = opts.secrets ?? {};
  const apiKey = secrets.aztecApiKey ?? network.apiKey;
  const progress = opts.onProgress ?? (() => {});

  progress("wallet", "Opening ephemeral Aztec wallet");
  const { node, wallet } = await openWallet(network, apiKey);

  let recipientAddress: AztecAddress;
  let l2SecretOut: string | undefined;
  let saltOut: string | undefined;
  const salt = parseAccountSalt(opts.salt, opts.randomSalt);

  if (opts.createAccount) {
    progress("account", "Creating initializerless Aztec account");
    const secret = opts.l2SecretKey ? Fr.fromHexString(opts.l2SecretKey) : Fr.random();
    l2SecretOut = secret.toString();
    saltOut = salt.toString();
    const manager = await registerInitializerlessAccount(wallet, secret, salt);
    recipientAddress = manager.address;
  } else {
    if (!opts.recipient) {
      throw new Error("`recipient` is required when createAccount is false.");
    }
    recipientAddress = AztecAddress.fromStringUnsafe(opts.recipient);
    if (opts.l2SecretKey) {
      progress("account", "Loading account from secret");
      await registerInitializerlessAccount(wallet, Fr.fromHexString(opts.l2SecretKey), salt);
      l2SecretOut = opts.l2SecretKey;
      saltOut = salt.toString();
    }
  }

  const amountWei = parseUnits(opts.amountFj, 18);
  const l1Key = resolveL1Key(network, secrets);
  const l1Backend = opts.l1Backend ?? resolveL1Backend(network);

  progress("l1-bridge", `Bridging ${opts.amountFj} FJ via ${l1Backend} to ${recipientAddress.toString()}`);
  const l1Result = await executeL1Bridge(network, node, recipientAddress, amountWei, l1Key, l1Backend);

  const credentials = l1Result.credentials;

  progress("l2-wait", "Waiting for L1→L2 message");
  await waitForL1ToL2Message({
    node,
    messageHash: Fr.fromHexString(credentials.messageHash),
    mode: network.bridgeTiming,
    warpOpts: { nodeUrl: network.aztecNodeUrl },
  });

  progress("l2-claim", "Claiming Fee Juice on L2");
  const caller = recipientAddress;
  const receipt = await claimWithBootstrap(wallet, caller, credentials);

  const l2TxHash = txHashFromSendResult(receipt);
  progress("done", l2TxHash);

  return {
    networkId: network.id,
    recipient: recipientAddress.toString(),
    claimCredentials: credentials,
    l2TxHash,
    l1TxHash: l1Result.l1TxHash,
    aztecAddress: recipientAddress.toString(),
    l2SecretKey: l2SecretOut,
    salt: saltOut,
  };
}

export async function bridgeL1Only(opts: RunBridgePipelineOptions): Promise<{
  credentials: ClaimCredentials;
  recipient: string;
  l2SecretKey?: string;
  salt?: string;
}> {
  const network = loadNetworkConfig(opts.networkId);
  const secrets = opts.secrets ?? {};
  const apiKey = secrets.aztecApiKey ?? network.apiKey;
  const node = createNode(network.aztecNodeUrl, apiKey);
  const salt = parseAccountSalt(opts.salt, opts.randomSalt);

  if (!opts.recipient && !opts.createAccount) {
    throw new Error("Provide --recipient or --create-account for L1-only bridge.");
  }

  let recipientAddress: AztecAddress;
  let l2SecretOut: string | undefined;
  if (opts.createAccount) {
    const { wallet } = await openWallet(network, apiKey);
    const secret = opts.l2SecretKey ? Fr.fromHexString(opts.l2SecretKey) : Fr.random();
    l2SecretOut = secret.toString();
    const manager = await registerInitializerlessAccount(wallet, secret, salt);
    recipientAddress = manager.address;
  } else {
    recipientAddress = AztecAddress.fromStringUnsafe(opts.recipient!);
  }

  const amountWei = parseUnits(opts.amountFj, 18);
  const l1Key = resolveL1Key(network, secrets);
  const l1Backend = opts.l1Backend ?? resolveL1Backend(network);

  const l1Result = await executeL1Bridge(
    network,
    node,
    recipientAddress,
    amountWei,
    l1Key,
    l1Backend,
  );

  return {
    recipient: recipientAddress.toString(),
    credentials: l1Result.credentials,
    l2SecretKey: l2SecretOut,
    salt: opts.createAccount ? salt.toString() : undefined,
  };
}

export async function waitAndClaimFromCredentials(params: {
  networkId: string;
  credentials: ClaimCredentials;
  callerAddress: string;
  l2SecretKey: string;
  /** Account salt hex; defaults to 0. */
  salt?: string;
  /** Schnorr signing key; omit to derive from secret (CLI convention). */
  signingKey?: string;
  secrets?: RuntimeSecrets;
  onProgress?: (phase: string, detail?: string) => void;
}): Promise<{ l2TxHash: string }> {
  const network = loadNetworkConfig(params.networkId);
  const secrets = params.secrets ?? {};
  const apiKey = secrets.aztecApiKey ?? network.apiKey;
  const progress = params.onProgress ?? (() => {});
  const salt = parseAccountSalt(params.salt);

  progress("wallet", "Opening ephemeral Aztec wallet");
  const { node, wallet } = await openWallet(network, apiKey);

  progress("account", "Loading claimer account");
  const manager = await registerInitializerlessAccount(
    wallet,
    Fr.fromHexString(params.l2SecretKey),
    salt,
    params.signingKey,
  );
  const expected = AztecAddress.fromStringUnsafe(params.callerAddress);
  if (!manager.address.equals(expected)) {
    throw new Error(
      `Registered account ${manager.address} does not match caller ${expected}. ` +
        `Wrong salt/signingKey — pass the account file's signingKey for dfpunk accounts.`,
    );
  }

  progress("l2-wait", "Waiting for L1→L2 message");
  await waitForL1ToL2Message({
    node,
    messageHash: Fr.fromHexString(params.credentials.messageHash),
    mode: network.bridgeTiming,
    warpOpts: { nodeUrl: network.aztecNodeUrl },
  });

  progress("l2-claim", "Claiming Fee Juice on L2");
  const receipt = await claimWithBootstrap(wallet, manager.address, params.credentials);
  const l2TxHash = txHashFromSendResult(receipt);
  progress("done", l2TxHash);
  return { l2TxHash };
}
