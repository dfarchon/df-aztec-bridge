import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { listNetworkIds, loadRuntimeSecrets, resolveNetworkId } from "../config/index.js";
import { runBridgePipeline } from "../core/pipeline.js";
import type { BridgeJobResult } from "../core/types.js";
import type { Hex } from "viem";

type JobStatus = "queued" | "running" | "succeeded" | "failed";

interface JobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: BridgeJobResult;
  request: {
    networkId: string;
    amountFj: string;
    recipient?: string;
    createAccount?: boolean;
  };
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
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

app.get("/health", (c) => c.json({ ok: true }));

app.get("/v1/networks", (c) => c.json({ networks: listNetworkIds() }));

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

app.get("/v1/jobs/:id", (c) => {
  const job = loadJob(c.req.param("id"));
  if (!job) return c.json({ error: "not found" }, 404);
  return c.json(job);
});

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 8787);

console.error(`df-aztec-bridge-kit API listening on http://${host}:${port}`);
serve({ fetch: app.fetch, hostname: host, port });
