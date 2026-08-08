/**
 * Deploy PrivateChatRegistry on a named L1 chain.
 *
 *   DEPLOYER_KEY=0x… pnpm deploy-l1-chat-registry [sepolia|mainnet|anvil]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import {
  deployL1ChatRegistry,
  type ChatRegistryChainName,
} from "@df-bridge/core";

function loadRootEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const VALID: ChatRegistryChainName[] = ["sepolia", "mainnet", "anvil"];

async function main() {
  const chainName = (process.argv[2] ?? "sepolia").toLowerCase() as ChatRegistryChainName;
  if (!VALID.includes(chainName)) {
    console.error(`Unknown chain: ${chainName}. Valid: ${VALID.join(", ")}`);
    process.exit(1);
  }

  const deployerKey = (process.env.DEPLOYER_KEY ?? process.env.L1_PRIVATE_KEY) as Hex | undefined;
  const rpcUrl =
    process.env.RPC_URL ??
    (chainName === "mainnet"
      ? process.env.MAINNET_L1_RPC_URL
      : chainName === "sepolia"
        ? process.env.TESTNET_L1_RPC_URL
        : process.env.LOCAL_L1_RPC_URL);

  if (!deployerKey && chainName !== "anvil") {
    console.error("Set DEPLOYER_KEY or L1_PRIVATE_KEY (repo-root .env).");
    process.exit(1);
  }

  const minBondWei = process.env.CHAT_MIN_BOND_WEI
    ? BigInt(process.env.CHAT_MIN_BOND_WEI)
    : 0n;

  const address = await deployL1ChatRegistry({
    chainName,
    rpcUrl,
    deployerKey,
    minBondWei,
  });
  console.error(`PrivateChatRegistry on ${chainName}: ${address}`);
  console.log(address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
