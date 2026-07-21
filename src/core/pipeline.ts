import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Fr } from "@aztec/foundation/curves/bn254";
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

async function registerInitializerlessAccount(wallet: EmbeddedWallet, secret: Fr) {
  const salt = Fr.random();
  const signingKey = deriveMasterMessageSigningSecretKey(secret);
  return wallet.createSchnorrInitializerlessAccount(secret, salt, signingKey, "main");
}

function txHashFromSendResult(result: { receipt: TxReceipt }) {
  return result.receipt.txHash.toString();
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

  if (opts.createAccount) {
    progress("account", "Creating initializerless Aztec account");
    const secret = opts.l2SecretKey ? Fr.fromHexString(opts.l2SecretKey) : Fr.random();
    l2SecretOut = secret.toString();
    const manager = await registerInitializerlessAccount(wallet, secret);
    recipientAddress = manager.address;
  } else {
    if (!opts.recipient) {
      throw new Error("`recipient` is required when createAccount is false.");
    }
    recipientAddress = AztecAddress.fromStringUnsafe(opts.recipient);
    if (opts.l2SecretKey) {
      progress("account", "Loading account from secret");
      await registerInitializerlessAccount(wallet, Fr.fromHexString(opts.l2SecretKey));
      l2SecretOut = opts.l2SecretKey;
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
  };
}

export async function bridgeL1Only(opts: RunBridgePipelineOptions): Promise<{
  credentials: ClaimCredentials;
  recipient: string;
}> {
  const network = loadNetworkConfig(opts.networkId);
  const secrets = opts.secrets ?? {};
  const apiKey = secrets.aztecApiKey ?? network.apiKey;
  const node = createNode(network.aztecNodeUrl, apiKey);

  if (!opts.recipient && !opts.createAccount) {
    throw new Error("Provide --recipient or --create-account for L1-only bridge.");
  }

  let recipientAddress: AztecAddress;
  if (opts.createAccount) {
    const { wallet } = await openWallet(network, apiKey);
    const secret = opts.l2SecretKey ? Fr.fromHexString(opts.l2SecretKey) : Fr.random();
    const manager = await registerInitializerlessAccount(wallet, secret);
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
  };
}

export async function waitAndClaimFromCredentials(params: {
  networkId: string;
  credentials: ClaimCredentials;
  callerAddress: string;
  l2SecretKey: string;
  secrets?: RuntimeSecrets;
}): Promise<{ l2TxHash: string }> {
  const network = loadNetworkConfig(params.networkId);
  const secrets = params.secrets ?? {};
  const apiKey = secrets.aztecApiKey ?? network.apiKey;
  const { node, wallet } = await openWallet(network, apiKey);

  await registerInitializerlessAccount(wallet, Fr.fromHexString(params.l2SecretKey));
  const caller = AztecAddress.fromStringUnsafe(params.callerAddress);

  await waitForL1ToL2Message({
    node,
    messageHash: Fr.fromHexString(params.credentials.messageHash),
    mode: network.bridgeTiming,
    warpOpts: { nodeUrl: network.aztecNodeUrl },
  });

  const receipt = await claimWithBootstrap(wallet, caller, params.credentials);
  return { l2TxHash: txHashFromSendResult(receipt) };
}
