import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkConfig, RuntimeSecrets, L1Backend } from "../core/types.js";
import type { Hex } from "viem";

/** Monorepo root (`config/networks` lives here). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const NETWORKS_DIR = join(ROOT, "config", "networks");

function resolveEnvPlaceholders<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? "") as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveEnvPlaceholders(v),
      ]),
    ) as T;
  }
  return value;
}

/** e.g. testnet → TESTNET_L1_RPC_URL */
function networkEnv(networkId: string, suffix: string): string | undefined {
  const key = `${networkId.toUpperCase().replace(/-/g, "_")}_${suffix}`;
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Global env (L1_RPC_URL, …) only applies when loading the active NETWORK preset,
 * so selecting mainnet in the UI is not forced onto Sepolia RPC from .env.
 */
function globalEnvIfActive(networkId: string, key: string): string | undefined {
  const active = process.env.NETWORK?.trim() || "testnet";
  if (active !== networkId) return undefined;
  const v = process.env[key]?.trim();
  return v || undefined;
}

export function listNetworkIds(): string[] {
  return readdirSync(NETWORKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadNetworkConfig(networkId: string): NetworkConfig {
  const path = join(NETWORKS_DIR, `${networkId}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as NetworkConfig;
  const config = resolveEnvPlaceholders(raw);

  const aztecNode =
    networkEnv(networkId, "AZTEC_NODE_URL") ?? globalEnvIfActive(networkId, "AZTEC_NODE_URL");
  const l1Rpc = networkEnv(networkId, "L1_RPC_URL") ?? globalEnvIfActive(networkId, "L1_RPC_URL");
  const l1Chain =
    networkEnv(networkId, "L1_CHAIN_ID") ?? globalEnvIfActive(networkId, "L1_CHAIN_ID");
  const apiKey = networkEnv(networkId, "AZTEC_API_KEY") ?? process.env.AZTEC_API_KEY?.trim();
  const backend =
    networkEnv(networkId, "L1_BACKEND") ?? globalEnvIfActive(networkId, "L1_BACKEND");

  if (aztecNode) config.aztecNodeUrl = aztecNode;
  if (l1Rpc) config.l1RpcUrl = l1Rpc;
  if (l1Chain) config.l1ChainId = Number(l1Chain);
  if (apiKey) config.apiKey = apiKey;
  if (backend === "portal" || backend === "gobridge") {
    config.l1Backend = backend;
  }

  return config;
}

export function resolveL1Backend(config: NetworkConfig): L1Backend {
  return config.l1Backend ?? "portal";
}

export function resolveNetworkId(explicit?: string): string {
  const id = explicit ?? process.env.NETWORK ?? "testnet";
  if (!listNetworkIds().includes(id)) {
    throw new Error(`Unknown network "${id}". Available: ${listNetworkIds().join(", ")}`);
  }
  return id;
}

function normalizeHexPrivateKey(raw: string | undefined): Hex | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      "Invalid L1 private key format. Expected 0x-prefixed 32-byte hex (66 chars total).",
    );
  }
  return trimmed as Hex;
}

export function loadRuntimeSecrets(overrides?: Partial<RuntimeSecrets>): RuntimeSecrets {
  const rawL1Key =
    overrides?.l1PrivateKey !== undefined ? String(overrides.l1PrivateKey) : process.env.L1_PRIVATE_KEY;
  const rawAztecApiKey =
    overrides?.aztecApiKey !== undefined ? String(overrides.aztecApiKey) : process.env.AZTEC_API_KEY;

  return {
    l1PrivateKey: normalizeHexPrivateKey(rawL1Key),
    aztecApiKey: rawAztecApiKey?.trim() || undefined,
  };
}
