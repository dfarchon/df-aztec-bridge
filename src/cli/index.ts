#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";

import { listNetworkIds, resolveNetworkId, loadRuntimeSecrets } from "../config/index.js";
import {
  bridgeL1Only,
  runBridgePipeline,
  waitAndClaimFromCredentials,
} from "../core/pipeline.js";
import type { ClaimCredentials } from "../core/types.js";
import type { Hex } from "viem";

const program = new Command();

function redactSecrets(input: string): string {
  // Redact any 32-byte hex-like secrets that may appear in error messages.
  return input.replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED]");
}

function printSafeError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${redactSecrets(msg)}`);
  process.exit(1);
}

program
  .name("df-bridge")
  .description("Fee Juice L1→L2 bridge (CLI)")
  .option("-n, --network <id>", "network preset", resolveNetworkId());

program
  .command("networks")
  .description("List configured networks")
  .action(() => {
    console.log(listNetworkIds().join("\n"));
  });

program
  .command("run")
  .description("Full pipeline: L1 bridge → wait → L2 claim")
  .requiredOption("-a, --amount <fj>", "amount in FJ (human-readable, e.g. 1000)")
  .option("-r, --recipient <address>", "Aztec L2 recipient")
  .option("--create-account", "create a new Aztec account and fund it")
  .option("--l1-key <hex>", "L1 private key (overrides L1_PRIVATE_KEY)")
  .option("--l2-secret <hex>", "L2 account secret (optional; generated when creating account)")
  .option("--l1-backend <portal|gobridge>", "L1 deposit path")
  .action(async (opts, cmd) => {
    try {
      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const secrets = loadRuntimeSecrets({
        l1PrivateKey: opts.l1Key as Hex | undefined,
      });

      const result = await runBridgePipeline({
        networkId,
        amountFj: opts.amount,
        recipient: opts.recipient,
        createAccount: opts.createAccount,
        l2SecretKey: opts.l2Secret,
        l1Backend: opts.l1Backend,
        secrets,
        onProgress: (phase, detail) => console.error(`[${phase}] ${detail ?? ""}`),
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      printSafeError(err);
    }
  });

program
  .command("l1-bridge")
  .description("L1 bridge only; prints claim credentials JSON")
  .requiredOption("-a, --amount <fj>", "amount in FJ")
  .option("-r, --recipient <address>", "Aztec recipient")
  .option("--create-account", "create recipient account first")
  .option("--l1-key <hex>", "L1 private key")
  .option("--l1-backend <portal|gobridge>", "L1 deposit path")
  .option("-o, --out <file>", "write credentials JSON to file")
  .action(async (opts, cmd) => {
    try {
      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const secrets = loadRuntimeSecrets({ l1PrivateKey: opts.l1Key as Hex | undefined });

      const { recipient, credentials } = await bridgeL1Only({
        networkId,
        amountFj: opts.amount,
        recipient: opts.recipient,
        createAccount: opts.createAccount,
        l1Backend: opts.l1Backend,
        secrets,
      });

      const payload = { recipient, credentials };
      const json = JSON.stringify(payload, null, 2);
      if (opts.out) writeFileSync(opts.out, json);
      console.log(json);
    } catch (err) {
      printSafeError(err);
    }
  });

program
  .command("claim")
  .description("Wait for L1→L2 message and claim using saved credentials")
  .requiredOption("-c, --credentials <file>", "JSON from l1-bridge")
  .requiredOption("--l2-secret <hex>", "L2 account secret for the claimer")
  .option("--caller <address>", "Aztec address (defaults to credentials.recipient)")
  .action(async (opts, cmd) => {
    try {
      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const parsed = JSON.parse(readFileSync(opts.credentials, "utf8")) as {
        recipient: string;
        credentials: ClaimCredentials;
      };

      const result = await waitAndClaimFromCredentials({
        networkId,
        credentials: parsed.credentials,
        callerAddress: opts.caller ?? parsed.recipient,
        l2SecretKey: opts.l2Secret,
        secrets: loadRuntimeSecrets(),
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      printSafeError(err);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  printSafeError(err);
});
