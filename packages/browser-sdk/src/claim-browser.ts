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

function parseSalt(raw?: string): Fr {
  if (!raw?.trim()) return DEFAULT_ACCOUNT_SALT;
  return Fr.fromHexString(raw.trim());
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

async function waitForMessage(node: ReturnType<typeof createAztecNodeClient>, messageHash: Fr, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isL1ToL2MessageReady(node, messageHash)) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for L1→L2 message ${messageHash.toString()}`);
}

/**
 * Wait for the L1→L2 message, then claim Fee Juice in the browser PXE.
 * Downloads a large Aztec chunk on first call — use only when
 * `VITE_ENABLE_BROWSER_CLAIM=true`.
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

  progress("wallet", "Loading browser EmbeddedWallet / PXE (large download on first use)…");
  const node = createBrowserNode(params.aztecNodeUrl, params.apiKey);
  const proverEnabled = params.networkId !== "local";
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled },
  });

  progress("account", "Registering claimer account");
  await registerAccount(wallet, secret, salt);
  const caller = AztecAddress.fromStringUnsafe(params.credentials.recipient);

  progress("l2-wait", "Waiting for L1→L2 message");
  await waitForMessage(
    node,
    Fr.fromHexString(params.credentials.messageHash),
    params.timeoutMs ?? 30 * 60_000,
  );

  progress("l2-claim", "Claiming Fee Juice on L2");
  const result = await claimWithBootstrap(wallet, caller, params.credentials);
  const l2TxHash = result.receipt.txHash.toString();
  progress("done", l2TxHash);
  return { l2TxHash };
}
