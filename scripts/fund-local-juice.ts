/**
 * Post-deploy Fee Juice for local `pnpm dev` / mprocs.
 *
 * Uses Aztec local-network test account #0 as signer, then Node EmbeddedWallet
 * (not browser PXE) to mint/bridge/claim → each address in
 * config/local-juice-fund.json (or LOCAL_JUICE_FUND_ADDRESSES).
 *
 *   pnpm fund:local-juice
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LIST = join(ROOT, "config/local-juice-fund.json");
const DEFAULT_AMOUNT = 1_000_000_000_000_000_000_000n; // 1000 FJ
const reqCore = createRequire(join(ROOT, "packages/core/package.json"));

/** Anvil default mnemonic used by `aztec start --local-network`. */
const ANVIL_MNEMONIC =
  "test test test test test test test test test test test junk";

type FundListFile = {
  networkId?: string;
  amount?: string;
  addresses?: string[];
};

async function importDep(specifier: string) {
  return import(pathToFileURL(reqCore.resolve(specifier)).href);
}

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

function isAztecAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(a.trim());
}

function loadAddresses(): { addresses: string[]; amount: bigint; networkId: string } {
  const networkId = (process.env.LOCAL_JUICE_NETWORK_ID ?? "local").toLowerCase();
  let fromFile: FundListFile = {};
  const listPath = process.env.LOCAL_JUICE_FUND_LIST ?? DEFAULT_LIST;
  if (existsSync(listPath)) {
    fromFile = JSON.parse(readFileSync(listPath, "utf8")) as FundListFile;
  }

  const envList = (process.env.LOCAL_JUICE_FUND_ADDRESSES ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const addresses = [...(fromFile.addresses ?? []), ...envList]
    .map((a) => a.trim().toLowerCase())
    .filter((a, i, all) => isAztecAddress(a) && all.indexOf(a) === i);

  const amountRaw = process.env.LOCAL_JUICE_FUND_AMOUNT ?? fromFile.amount;
  const amount = amountRaw ? BigInt(amountRaw) : DEFAULT_AMOUNT;

  return {
    addresses,
    amount,
    networkId: (fromFile.networkId ?? networkId).toLowerCase(),
  };
}

function fieldToHex(value: { toString(): string } | string): string {
  const s = typeof value === "string" ? value : value.toString();
  if (s.startsWith("0x")) return s;
  try {
    return `0x${BigInt(s).toString(16).padStart(64, "0")}`;
  } catch {
    return s;
  }
}

async function resolveTestingAccounts() {
  const reqSdk = createRequire(join(ROOT, "packages/browser-sdk/package.json"));
  const walletsEntry = reqSdk.resolve("@aztec/wallets/embedded");
  const reqWallets = createRequire(walletsEntry);
  const testingPath = reqWallets.resolve("@aztec/accounts/testing");
  const { getInitialTestAccountsData } = await import(pathToFileURL(testingPath).href);
  return getInitialTestAccountsData() as Promise<
    Array<{
      address: { toString(): string };
      secret: { toString(): string };
      salt: { toString(): string };
      signingKey: { toString(): string };
    }>
  >;
}

async function main() {
  loadRootEnv();

  if ((process.env.SKIP_LOCAL_JUICE ?? "0") === "1") {
    console.error("SKIP_LOCAL_JUICE=1 — skipping local Fee Juice fund.");
    return;
  }

  const { addresses, amount, networkId } = loadAddresses();
  if (networkId !== "local") {
    console.error(`fund-local-juice only runs for local (got ${networkId}).`);
    process.exit(0);
  }
  if (addresses.length === 0) {
    console.error("No local juice fund addresses (config/local-juice-fund.json).");
    process.exit(0);
  }

  const aztecNodeUrl =
    process.env.LOCAL_AZTEC_NODE_URL ??
    process.env.VITE_LOCAL_AZTEC_NODE_URL ??
    "http://localhost:8080";
  const l1RpcUrl =
    process.env.LOCAL_L1_RPC_URL ??
    process.env.VITE_LOCAL_L1_RPC_URL ??
    "http://localhost:8545";
  const apiKey =
    process.env.LOCAL_AZTEC_API_KEY?.trim() ||
    process.env.AZTEC_API_KEY?.trim() ||
    undefined;

  console.error(`Local Fee Juice fund → ${addresses.length} address(es)`);
  console.error(`Aztec: ${aztecNodeUrl}`);
  console.error(`L1:    ${l1RpcUrl}`);

  const testAccounts = await resolveTestingAccounts();
  const signer = testAccounts[0];
  if (!signer) {
    throw new Error(
      "No Aztec local test accounts. Start with `aztec start --local-network` (testAccounts).",
    );
  }

  const signerAddress = signer.address.toString();
  const secretKey = fieldToHex(signer.secret);
  const salt = fieldToHex(signer.salt);
  const signingKey = fieldToHex(signer.signingKey);
  console.error(`Signer (test account #0): ${signerAddress}`);

  // Node EmbeddedWallet / PXE — do not import browser-sdk claim/moveJuice (OPFS Worker).
  const { createAztecNodeClient } = await importDep("@aztec/aztec.js/node");
  const { defaultFetch } = await importDep("@aztec/foundation/json-rpc/client");
  const { NO_WAIT } = await importDep("@aztec/aztec.js/contracts");
  const { FeeJuicePaymentMethodWithClaim, SponsoredFeePaymentMethod } = await importDep(
    "@aztec/aztec.js/fee",
  );
  const { ProtocolContractAddress } = await importDep("@aztec/aztec.js/protocol");
  const { getFeeJuiceBalance } = await importDep("@aztec/aztec.js/utils");
  const { L1FeeJuicePortalManager } = await importDep("@aztec/aztec.js/ethereum");
  const { Fr, Fq } = await importDep("@aztec/foundation/curves/bn254");
  const { createLogger } = await importDep("@aztec/foundation/log");
  const { FunctionCall, FunctionSelector, FunctionType } = await importDep("@aztec/stdlib/abi");
  const { AztecAddress } = await importDep("@aztec/stdlib/aztec-address");
  const { ExecutionPayload, mergeExecutionPayloads } = await importDep("@aztec/stdlib/tx");
  const { getPXEConfig } = await importDep("@aztec/pxe/server");
  const { EmbeddedWallet } = await importDep("@aztec/wallets/embedded");
  const { createWalletClient, http, publicActions } = await importDep("viem");
  const { mnemonicToAccount } = await importDep("viem/accounts");
  const { foundry } = await importDep("viem/chains");
  // Warp L1/L2 slots while waiting (idle anvil does not auto-advance without empty checkpoints).
  const { waitForL1ToL2Message } = await import("@df-bridge/core");

  const fetchFn = apiKey
    ? (host: string, body: unknown, extraHeaders: Record<string, string> = {}, noRetry = false) =>
        defaultFetch(host, body, { ...extraHeaders, "X-Aztec-API-Key": apiKey }, noRetry)
    : undefined;
  const node = createAztecNodeClient(aztecNodeUrl, undefined, fetchFn);

  console.error("Opening Node EmbeddedWallet / PXE…");
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { ...getPXEConfig(), proverEnabled: false },
  });

  const from = (
    await wallet.createSchnorrInitializerlessAccount(
      Fr.fromHexString(secretKey),
      Fr.fromHexString(salt),
      Fq.fromHexString(signingKey),
      "main",
    )
  ).address;
  console.error(`Registered signer in PXE: ${from.toString()}`);

  let sponsoredFpc: InstanceType<typeof AztecAddress> | null = null;
  try {
    const { registerSharedSponsoredFpc } = await import(
      "../packages/browser-sdk/src/sponsored-fee.ts"
    );
    sponsoredFpc = await registerSharedSponsoredFpc(wallet);
    console.error(`Sponsored FPC: ${sponsoredFpc.toString()}`);
  } catch (e) {
    console.error(
      `Sponsored FPC register skipped: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const l1Account = mnemonicToAccount(ANVIL_MNEMONIC);
  const l1Client = createWalletClient({
    account: l1Account,
    chain: foundry,
    transport: http(l1RpcUrl),
  }).extend(publicActions);
  const logger = createLogger("df-bridge:fund-local-juice");
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client as never, logger);

  let failed = 0;
  for (const targetHex of addresses) {
    console.error(`\n→ fund target ${targetHex}`);
    try {
      const recipient = AztecAddress.fromStringUnsafe(targetHex);
      const before = await getFeeJuiceBalance(recipient, node).catch(() => 0n);
      if (before >= amount) {
        console.error(`  ok skipped already-funded balance=${before.toString()}`);
        continue;
      }

      console.error(`  Bridging ${amount.toString()} Fee Juice wei (mint)…`);
      const claim = await portalManager.bridgeTokensPublic(recipient, amount, true);
      const messageHash = Fr.fromHexString(claim.messageHash);
      console.error("  Waiting for L1→L2 Fee Juice message (warp)…");
      await waitForL1ToL2Message({
        node,
        messageHash,
        mode: "warp",
        timeoutMs: 10 * 60 * 1000,
        warpOpts: { nodeUrl: aztecNodeUrl },
      });

      let feeMode: "sponsored" | "claim-self" = "claim-self";
      let txHash = "";

      if (sponsoredFpc) {
        try {
          const selector = await FunctionSelector.fromSignature(
            "claim((Field),u128,Field,Field)",
          );
          const call = FunctionCall.from({
            name: "claim",
            to: ProtocolContractAddress.FeeJuice,
            selector,
            type: FunctionType.PRIVATE,
            hideMsgSender: false,
            isStatic: false,
            args: [
              recipient.toField(),
              new Fr(claim.claimAmount),
              claim.claimSecret,
              new Fr(claim.messageLeafIndex),
            ],
            returnTypes: [],
          });
          const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpc);
          const feePayload = await paymentMethod.getExecutionPayload();
          const claimPayload = new ExecutionPayload([call], [], [], []);
          const merged = mergeExecutionPayloads([feePayload, claimPayload]);
          const sent = await wallet.sendTx(merged, { from, wait: NO_WAIT });
          txHash = sent.txHash?.toString?.() ?? String(sent.txHash ?? "");
          feeMode = "sponsored";
        } catch {
          txHash = "";
        }
      }

      if (!txHash) {
        const paymentMethod = new FeeJuicePaymentMethodWithClaim(recipient, {
          claimAmount: claim.claimAmount,
          claimSecret: claim.claimSecret,
          messageLeafIndex: claim.messageLeafIndex,
        });
        const executionPayload = await paymentMethod.getExecutionPayload();
        const sent = await wallet.sendTx(executionPayload, { from, wait: NO_WAIT });
        txHash = sent.txHash?.toString?.() ?? String(sent.txHash ?? "");
        feeMode = "claim-self";
      }

      console.error(`  Claim submitted ${txHash} (fee=${feeMode})`);
      for (let i = 0; i < 60; i += 1) {
        const bal = await getFeeJuiceBalance(recipient, node).catch(() => 0n);
        if (bal >= amount) {
          console.error(`  ok funded=true balance=${bal.toString()} fee=${feeMode}`);
          break;
        }
        if (i === 59) {
          console.error(`  ok submitted balance=${bal.toString()} (still syncing) fee=${feeMode}`);
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
    } catch (e) {
      failed += 1;
      console.error(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    await wallet.stop();
  } catch {
    /* ignore */
  }

  if (failed > 0) {
    console.error(`\n${failed}/${addresses.length} fund(s) failed.`);
    process.exit(1);
  }
  console.error("\nLocal Fee Juice fund complete.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
