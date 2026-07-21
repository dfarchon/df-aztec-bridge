import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  listNetworkIds,
  loadNetworkConfig,
  loadRuntimeSecrets,
  resolveNetworkId,
  runBridgePipeline,
  waitAndClaimFromCredentials,
  createNode,
  fetchL1Addresses,
  type BridgeJobResult,
  type ClaimCredentials,
} from "@df-bridge/core";
import type { Hex } from "viem";

type JobStatus = "queued" | "running" | "succeeded" | "failed";

interface JobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: BridgeJobResult;
  request: Record<string, unknown>;
}

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

function redactSecrets(input: string): string {
  return input.replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED]");
}

function jobPath(id: string) {
  return join(DATA_DIR, `${id}.json`);
}

function saveJob(job: JobRecord) {
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
}

function loadJob(id: string): JobRecord | null {
  try {
    return JSON.parse(readFileSync(jobPath(id), "utf8")) as JobRecord;
  } catch {
    return null;
  }
}

const app = new Hono();
app.use("/*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.get("/v1/networks", (c) => c.json({ networks: listNetworkIds() }));

app.get("/v1/networks/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const config = loadNetworkConfig(id);
    const apiKey = process.env.AZTEC_API_KEY ?? config.apiKey;
    const node = createNode(config.aztecNodeUrl, apiKey);
    const l1Addresses = await fetchL1Addresses(node);
    return c.json({
      id: config.id,
      name: config.name,
      aztecNodeUrl: config.aztecNodeUrl,
      l1RpcUrl: config.l1RpcUrl,
      l1ChainId: config.l1ChainId,
      bridgeTiming: config.bridgeTiming,
      l1Backend: config.l1Backend ?? "portal",
      l1Addresses,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 404);
  }
});

app.post("/v1/bridge", async (c) => {
  const body = (await c.req.json()) as {
    network?: string;
    amountFj: string;
    recipient?: string;
    createAccount?: boolean;
    l1PrivateKey?: Hex;
    l2SecretKey?: string;
    l1Backend?: "portal" | "gobridge";
  };

  if (!body.amountFj) {
    return c.json({ error: "amountFj is required" }, 400);
  }

  const networkId = resolveNetworkId(body.network);
  const id = randomUUID();
  const now = new Date().toISOString();

  const job: JobRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request: {
      networkId,
      amountFj: body.amountFj,
      recipient: body.recipient,
      createAccount: body.createAccount,
    },
  };
  saveJob(job);

  void (async () => {
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    saveJob(job);
    try {
      job.result = await runBridgePipeline({
        networkId,
        amountFj: body.amountFj,
        recipient: body.recipient,
        createAccount: body.createAccount,
        l2SecretKey: body.l2SecretKey,
        l1Backend: body.l1Backend,
        secrets: loadRuntimeSecrets({ l1PrivateKey: body.l1PrivateKey }),
      });
      job.status = "succeeded";
    } catch (err) {
      job.status = "failed";
      const message = err instanceof Error ? err.message : String(err);
      job.error = redactSecrets(message);
    }
    job.updatedAt = new Date().toISOString();
    saveJob(job);
  })();

  return c.json({ jobId: id, status: job.status }, 202);
});

app.post("/v1/claim", async (c) => {
  const body = (await c.req.json()) as {
    network?: string;
    credentials: ClaimCredentials;
    callerAddress: string;
    l2SecretKey: string;
    salt?: string;
    signingKey?: string;
  };

  if (!body.credentials || !body.callerAddress || !body.l2SecretKey) {
    return c.json({ error: "credentials, callerAddress, and l2SecretKey are required" }, 400);
  }

  const networkId = resolveNetworkId(body.network);
  const id = randomUUID();
  const now = new Date().toISOString();

  const job: JobRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request: { networkId, type: "claim", callerAddress: body.callerAddress },
  };
  saveJob(job);

  void (async () => {
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    saveJob(job);
    try {
      const result = await waitAndClaimFromCredentials({
        networkId,
        credentials: body.credentials,
        callerAddress: body.callerAddress,
        l2SecretKey: body.l2SecretKey,
        salt: body.salt,
        signingKey: body.signingKey,
        secrets: loadRuntimeSecrets(),
      });
      job.result = {
        networkId,
        recipient: body.callerAddress,
        claimCredentials: body.credentials,
        l2TxHash: result.l2TxHash,
      };
      job.status = "succeeded";
    } catch (err) {
      job.status = "failed";
      const message = err instanceof Error ? err.message : String(err);
      job.error = redactSecrets(message);
    }
    job.updatedAt = new Date().toISOString();
    saveJob(job);
  })();

  return c.json({ jobId: id, status: job.status }, 202);
});

app.get("/v1/jobs/:id", (c) => {
  const job = loadJob(c.req.param("id"));
  if (!job) return c.json({ error: "not found" }, 404);
  return c.json(job);
});

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 8787);

const server = serve({ fetch: app.fetch, hostname: host, port });
server.on("listening", () => {
  console.error(`@df-bridge/api listening on http://${host}:${port}`);
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `@df-bridge/api failed: ${host}:${port} already in use. Kill it with: lsof -ti :${port} | xargs kill -9`,
    );
  } else {
    console.error("@df-bridge/api failed to start:", err);
  }
  process.exit(1);
});
