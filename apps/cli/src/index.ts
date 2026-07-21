#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";

import {
  listNetworkIds,
  resolveNetworkId,
  loadRuntimeSecrets,
  bridgeL1Only,
  runBridgePipeline,
  waitAndClaimFromCredentials,
  createAztecAccount,
  type ClaimCredentials,
} from "@df-bridge/core";
import type { Hex } from "viem";

const program = new Command();

function redactSecrets(input: string): string {
  return input.replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED]");
}

function printSafeError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${redactSecrets(msg)}`);
  process.exit(1);
}

function writeJson(path: string | undefined, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  if (path) writeFileSync(path, `${json}\n`);
  console.log(json);
}

/** Accept run / l1-bridge / raw claimCredentials JSON shapes. */
function parseCredentialsFile(path: string): {
  recipient: string;
  credentials: ClaimCredentials;
  l2SecretKey?: string;
  salt?: string;
} {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

  if (raw.claimCredentials && typeof raw.claimCredentials === "object") {
    const credentials = raw.claimCredentials as ClaimCredentials;
    return {
      recipient: String(raw.recipient ?? raw.aztecAddress ?? credentials.recipient),
      credentials,
      l2SecretKey: typeof raw.l2SecretKey === "string" ? raw.l2SecretKey : undefined,
      salt: typeof raw.salt === "string" ? raw.salt : undefined,
    };
  }

  if (raw.credentials && typeof raw.credentials === "object") {
    const credentials = raw.credentials as ClaimCredentials;
    return {
      recipient: String(raw.recipient ?? credentials.recipient),
      credentials,
      l2SecretKey: typeof raw.l2SecretKey === "string" ? raw.l2SecretKey : undefined,
      salt: typeof raw.salt === "string" ? raw.salt : undefined,
    };
  }

  if (raw.claimSecret && raw.messageHash && raw.recipient) {
    const credentials = raw as unknown as ClaimCredentials;
    return { recipient: credentials.recipient, credentials };
  }

  throw new Error(
    "Unrecognized credentials JSON. Expected run output, l1-bridge output, or raw ClaimCredentials.",
  );
}

function resolveSaltOpts(opts: { salt?: string; randomSalt?: boolean }): {
  salt?: string;
  randomSalt?: boolean;
} {
  if (opts.randomSalt && opts.salt) {
    throw new Error("Pass either --salt <hex> or --random-salt, not both.");
  }
  return { salt: opts.salt, randomSalt: opts.randomSalt };
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
  .command("create-account")
  .description("Create an Aztec L2 account (initializerless) and print address + secret")
  .option("--l2-secret <hex>", "use this L2 secret instead of generating one")
  .option("--salt <hex>", "fixed account salt (default 0)")
  .option("--random-salt", "generate a random salt (save it; needed to reopen the account)")
  .option("-o, --out <file>", "write account JSON to file")
  .action(async (opts, cmd) => {
    try {
      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const saltOpts = resolveSaltOpts(opts);
      const result = await createAztecAccount({
        networkId,
        l2SecretKey: opts.l2Secret,
        ...saltOpts,
        secrets: loadRuntimeSecrets(),
        onProgress: (phase, detail) => console.error(`[${phase}] ${detail ?? ""}`),
      });
      console.error(`[ok] create-account succeeded → ${result.aztecAddress}`);
      writeJson(opts.out, result);
    } catch (err) {
      printSafeError(err);
    }
  });

program
  .command("run")
  .description("Full pipeline: L1 bridge → wait → L2 claim")
  .requiredOption("-a, --amount <fj>", "amount in FJ (human-readable, e.g. 1000)")
  .option("-r, --recipient <address>", "Aztec L2 recipient")
  .option("--create-account", "create a new Aztec account and fund it")
  .option("--l1-key <hex>", "L1 private key (overrides L1_PRIVATE_KEY)")
  .option("--l2-secret <hex>", "L2 account secret (optional; generated when creating account)")
  .option("--salt <hex>", "fixed account salt (default 0)")
  .option("--random-salt", "generate a random salt when creating/loading account")
  .option("--l1-backend <portal|gobridge>", "L1 deposit path")
  .option("-o, --out <file>", "write result JSON to file")
  .action(async (opts, cmd) => {
    try {
      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const secrets = loadRuntimeSecrets({
        l1PrivateKey: opts.l1Key as Hex | undefined,
      });
      const saltOpts = resolveSaltOpts(opts);

      const result = await runBridgePipeline({
        networkId,
        amountFj: opts.amount,
        recipient: opts.recipient,
        createAccount: opts.createAccount,
        l2SecretKey: opts.l2Secret,
        ...saltOpts,
        l1Backend: opts.l1Backend,
        secrets,
        onProgress: (phase: string, detail?: string) => console.error(`[${phase}] ${detail ?? ""}`),
      });

      writeJson(opts.out, result);
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
  .option("--l2-secret <hex>", "L2 secret when using --create-account")
  .option("--salt <hex>", "fixed account salt (default 0)")
  .option("--random-salt", "generate a random salt when creating account")
  .option("--l1-backend <portal|gobridge>", "L1 deposit path")
  .option("-o, --out <file>", "write credentials JSON to file")
  .action(async (opts, cmd) => {
    try {
      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const secrets = loadRuntimeSecrets({ l1PrivateKey: opts.l1Key as Hex | undefined });
      const saltOpts = resolveSaltOpts(opts);

      const { recipient, credentials, l2SecretKey, salt } = await bridgeL1Only({
        networkId,
        amountFj: opts.amount,
        recipient: opts.recipient,
        createAccount: opts.createAccount,
        l2SecretKey: opts.l2Secret,
        ...saltOpts,
        l1Backend: opts.l1Backend,
        secrets,
      });

      writeJson(opts.out, { recipient, credentials, l2SecretKey, salt });
    } catch (err) {
      printSafeError(err);
    }
  });

program
  .command("claim")
  .description("Wait for L1→L2 message and claim Fee Juice using saved credentials")
  .option("-c, --credentials <file>", "JSON from run / l1-bridge / claimCredentials")
  .option("--l2-secret <hex>", "L2 account secret for the claimer")
  .option("--salt <hex>", "account salt (default 0, or value from credentials JSON)")
  .option("--caller <address>", "Aztec address (defaults to credentials.recipient)")
  .option("-o, --out <file>", "write result JSON to file")
  .action(async (opts, cmd) => {
    try {
      if (!opts.credentials) {
        throw new Error("Provide -c/--credentials <file>");
      }

      const networkId = cmd.parent?.opts().network ?? resolveNetworkId();
      const parsed = parseCredentialsFile(opts.credentials);
      const l2Secret = opts.l2Secret ?? parsed.l2SecretKey;
      if (!l2Secret) {
        throw new Error("Provide --l2-secret (or include l2SecretKey in the credentials JSON).");
      }

      const result = await waitAndClaimFromCredentials({
        networkId,
        credentials: parsed.credentials,
        callerAddress: opts.caller ?? parsed.recipient,
        l2SecretKey: l2Secret,
        salt: opts.salt ?? parsed.salt,
        secrets: loadRuntimeSecrets(),
        onProgress: (phase, detail) => console.error(`[${phase}] ${detail ?? ""}`),
      });

      writeJson(opts.out, {
        ...result,
        recipient: opts.caller ?? parsed.recipient,
        credentials: parsed.credentials,
      });
    } catch (err) {
      printSafeError(err);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  printSafeError(err);
});
