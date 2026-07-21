import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkConfig, RuntimeSecrets, L1Backend } from "../core/types.js";
import type { Hex } from "viem";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

export function listNetworkIds(): string[] {
  return readdirSync(NETWORKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadNetworkConfig(networkId: string): NetworkConfig {
  const path = join(NETWORKS_DIR, `${networkId}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as NetworkConfig;
  const config = resolveEnvPlaceholders(raw);

  if (process.env.AZTEC_NODE_URL) config.aztecNodeUrl = process.env.AZTEC_NODE_URL;
  if (process.env.L1_RPC_URL) config.l1RpcUrl = process.env.L1_RPC_URL;
  if (process.env.L1_CHAIN_ID) config.l1ChainId = Number(process.env.L1_CHAIN_ID);
  if (process.env.AZTEC_API_KEY) config.apiKey = process.env.AZTEC_API_KEY;
  if (process.env.L1_BACKEND === "portal" || process.env.L1_BACKEND === "gobridge") {
    config.l1Backend = process.env.L1_BACKEND;
  }

  return config;
}

export function resolveL1Backend(config: NetworkConfig): L1Backend {
  return config.l1Backend ?? "gobridge";
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
