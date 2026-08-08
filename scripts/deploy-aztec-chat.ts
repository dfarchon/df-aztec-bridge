/**
 * Deploy PrivateChat Noir contract to Aztec local / testnet / mainnet.
 *
 *   AZTEC_DEPLOYER_KEY=0x… pnpm deploy-aztec-chat [local|testnet|mainnet]
 *
 * Requires Aztec toolchain 5.1.0 + compiled artifact at
 *   contracts/aztec/private_chat/target/private_chat_contract-PrivateChat.json
 *
 * Without a compiled artifact, this script validates env/network config and
 * updates config/deployments/chat.json placeholders (dry scaffolding mode).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type NetworkName = "local" | "testnet" | "mainnet";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS_PATH = join(ROOT, "config/deployments/chat.json");
const WEB_DEPLOYMENTS_PATH = join(
  ROOT,
  "apps/web/src/chat/aztec/generated/deployments.json",
);
const ARTIFACT_CANDIDATES = [
  join(ROOT, "contracts/aztec/private_chat/target/private_chat_contract-PrivateChat.json"),
  join(ROOT, "contracts/aztec/private_chat/target/PrivateChat.json"),
];

function loadRootEnv() {
  const envPath = join(ROOT, ".env");
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

function networkUrls(network: NetworkName): { aztecNodeUrl: string; l1RpcUrl: string } {
  if (network === "mainnet") {
    return {
      aztecNodeUrl: process.env.MAINNET_AZTEC_NODE_URL ?? "",
      l1RpcUrl: process.env.MAINNET_L1_RPC_URL ?? "",
    };
  }
  if (network === "testnet") {
    return {
      aztecNodeUrl: process.env.TESTNET_AZTEC_NODE_URL ?? "",
      l1RpcUrl: process.env.TESTNET_L1_RPC_URL ?? "",
    };
  }
  return {
    aztecNodeUrl: process.env.LOCAL_AZTEC_NODE_URL ?? "http://localhost:8080",
    l1RpcUrl: process.env.LOCAL_L1_RPC_URL ?? "http://localhost:8545",
  };
}

function findArtifact(): string | null {
  for (const p of ARTIFACT_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

function updateDeployments(
  network: NetworkName,
  patch: { aztecChat?: string; classId?: string; l1Registry?: string },
) {
  mkdirSync(dirname(DEPLOYMENTS_PATH), { recursive: true });
  const current = existsSync(DEPLOYMENTS_PATH)
    ? JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"))
    : {};
  current[network] = {
    network,
    aztecPackageVersion: "5.1.0",
    ...(current[network] ?? {}),
    ...patch,
  };
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(current, null, 2) + "\n");
  writeFileSync(WEB_DEPLOYMENTS_PATH, JSON.stringify(current, null, 2) + "\n");
}

async function deployWithAztecJs(
  network: NetworkName,
  artifactPath: string,
): Promise<{ address: string; classId: string }> {
  const { aztecNodeUrl } = networkUrls(network);
  if (!aztecNodeUrl) {
    throw new Error(`Missing Aztec node URL for ${network}`);
  }

  // Dynamic import keeps script loadable when artifact/deploy path is dry-run only.
  const { createAztecNodeClient } = await import("@aztec/aztec.js/node");
  const { loadContractArtifact } = await import("@aztec/stdlib/abi");
  const { Contract } = await import("@aztec/aztec.js/contract");

  const secret = (process.env.AZTEC_DEPLOYER_KEY ?? process.env.DEPLOYER_KEY) as
    | `0x${string}`
    | undefined;
  if (!secret) {
    throw new Error("Set AZTEC_DEPLOYER_KEY or DEPLOYER_KEY for Aztec deploy");
  }

  const artifactJson = JSON.parse(readFileSync(artifactPath, "utf8"));
  const artifact = loadContractArtifact(artifactJson);
  const node = createAztecNodeClient(aztecNodeUrl);

  // Wallet / PXE bootstrap differs by environment; prefer documented 5.1 pattern.
  const { getInitialTestAccountsManagers } = await import("@aztec/accounts/testing").catch(
    () => ({ getInitialTestAccountsManagers: null }),
  );

  let fromAddress: { toString(): string };
  let wallet: unknown;

  if (network === "local" && getInitialTestAccountsManagers) {
    const { createPXE } = await import("@aztec/pxe/client/lazy").catch(async () => {
      return await import("@aztec/pxe");
    });
    // Local sandbox: use first test account when available.
    const pxe = await (createPXE as (n: unknown, opts?: unknown) => Promise<unknown>)(node, {
      // ephemeral local pxe
    }).catch(async () => {
      throw new Error(
        "Could not create PXE for local deploy. Start the Aztec local network (5.1) and retry.",
      );
    });
    const managers = await getInitialTestAccountsManagers(pxe as never);
    const walletManager = managers[0];
    if (!walletManager) throw new Error("No test accounts in local PXE");
    wallet = await walletManager.register();
    fromAddress = (wallet as { getAddress(): { toString(): string } }).getAddress();
  } else {
    throw new Error(
      `Live deploy to ${network} requires a compiled artifact and a funded Aztec account wired via PXE. ` +
        `Artifact found at ${artifactPath}. Set up PXE + account, then re-run, or pass --dry-run.`,
    );
  }

  const deployed = await (
    Contract as {
      deploy: (
        wallet: unknown,
        artifact: unknown,
        args: unknown[],
      ) => { send: (opts: { from: unknown }) => Promise<{ contract: { address: { toString(): string } } }> };
    }
  )
    .deploy(wallet, artifact, [])
    .send({ from: fromAddress });

  const address = deployed.contract.address.toString();
  const classId =
    (artifactJson.classId as string | undefined) ??
    (artifactJson.artifactHash as string | undefined) ??
    "";

  console.error(`PrivateChat deployed on ${network}: ${address}`);
  return { address, classId };
}

async function main() {
  loadRootEnv();
  const network = (process.argv[2] ?? "local").toLowerCase() as NetworkName;
  const dryRun = process.argv.includes("--dry-run");
  if (!["local", "testnet", "mainnet"].includes(network)) {
    console.error("Usage: pnpm deploy-aztec-chat [local|testnet|mainnet] [--dry-run]");
    process.exit(1);
  }

  const urls = networkUrls(network);
  console.error(`Network: ${network}`);
  console.error(`Aztec node: ${urls.aztecNodeUrl || "(missing)"}`);
  console.error(`L1 RPC: ${urls.l1RpcUrl || "(missing)"}`);

  const artifactPath = findArtifact();
  if (!artifactPath || dryRun) {
    console.error(
      artifactPath
        ? "Dry-run: not sending deploy tx."
        : "No compiled artifact found — write placeholder deployment entry.",
    );
    console.error(
      "Compile with Aztec 5.1: cd contracts/aztec/private_chat && aztec-nargo compile",
    );
    updateDeployments(network, {
      aztecChat: process.env[`VITE_CHAT_AZTEC_ADDRESS_${network.toUpperCase()}`] ?? "",
      classId: process.env[`VITE_CHAT_CLASS_ID_${network.toUpperCase()}`] ?? "",
      l1Registry: process.env[`VITE_CHAT_L1_REGISTRY_${network.toUpperCase()}`] ?? "",
    });
    console.log(DEPLOYMENTS_PATH);
    return;
  }

  const { address, classId } = await deployWithAztecJs(network, artifactPath);
  updateDeployments(network, {
    aztecChat: address,
    classId,
    l1Registry: process.env[`VITE_CHAT_L1_REGISTRY_${network.toUpperCase()}`] ?? "",
  });
  console.log(address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
