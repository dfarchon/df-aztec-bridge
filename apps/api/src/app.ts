import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from "node:fs";
import type { HttpBindings } from "@hono/node-server";

import {
  listNetworkIds,
  loadNetworkConfig,
  loadRuntimeSecrets,
  resolveNetworkId,
  waitAndClaimFromCredentials,
  createNode,
  fetchL1Addresses,
  type ClaimCredentials,
} from "@df-bridge/core";
import {
  clientKey,
  createApiAuthMiddleware,
  createSecurityHeadersMiddleware,
  isClaimEndpointEnabled,
  parseCorsOrigins,
  redactSecrets,
} from "./security.ts";

type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** Public job view — never includes private keys or claim secrets. */
export interface PublicJobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  request: Record<string, unknown>;
  result?: {
    networkId: string;
    recipient: string;
    l1TxHash?: string;
    l2TxHash?: string;
    aztecAddress?: string;
    messageHash?: string;
    messageLeafIndex?: string;
    claimAmount?: string;
  };
}

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const MAX_BODY_BYTES = Number(process.env.API_MAX_BODY_BYTES ?? 32_768);
const MAX_CONCURRENT_JOBS = Number(process.env.API_MAX_CONCURRENT_JOBS ?? 2);
const RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX ?? 10);
const JOB_TTL_MS = Number(process.env.API_JOB_TTL_MS ?? 60 * 60 * 1000);
const HEX_64 = /^0x[0-9a-fA-F]{64}$/;
const AZTEC_ADDR = /^(0x)?[0-9a-fA-F]{1,64}$/;

let runningJobs = 0;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jobPath(id: string) {
  return join(DATA_DIR, `${id}.json`);
}

function saveJob(job: PublicJobRecord) {
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), { mode: 0o600 });
}

function loadJob(id: string): PublicJobRecord | null {
  try {
    return JSON.parse(readFileSync(jobPath(id), "utf8")) as PublicJobRecord;
  } catch {
    return null;
  }
}

function cleanupExpiredJobs() {
  const now = Date.now();
  try {
    for (const name of readdirSync(DATA_DIR)) {
      if (!name.endsWith(".json")) continue;
      const full = join(DATA_DIR, name);
      try {
        const st = statSync(full);
        if (now - st.mtimeMs > JOB_TTL_MS) unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

function validateAmount(amount: string): string | null {
  if (!/^\d+$/.test(amount)) return "amount must be a positive integer string (wei)";
  try {
    const v = BigInt(amount);
    if (v <= 0n) return "amount must be > 0";
    if (v > 10n ** 30n) return "amount exceeds maximum";
  } catch {
    return "invalid amount";
  }
  return null;
}

export function validateClaimBody(body: {
  network?: string;
  credentials?: ClaimCredentials;
  callerAddress?: string;
  l2SecretKey?: string;
  salt?: string;
  signingKey?: string;
  l1PrivateKey?: unknown;
}): string | null {
  if (body.l1PrivateKey !== undefined) {
    return "l1PrivateKey is not accepted over the API";
  }
  if (!body.credentials || !body.callerAddress || !body.l2SecretKey) {
    return "credentials, callerAddress, and l2SecretKey are required";
  }
  if (!AZTEC_ADDR.test(body.callerAddress)) return "invalid callerAddress";
  if (!HEX_64.test(body.l2SecretKey)) return "l2SecretKey must be 0x-prefixed 32-byte hex";
  if (body.salt !== undefined && body.salt !== "" && !HEX_64.test(body.salt) && body.salt !== "0x0") {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(body.salt)) return "invalid salt";
  }
  if (body.signingKey !== undefined && body.signingKey !== "" && !HEX_64.test(body.signingKey)) {
    return "signingKey must be 0x-prefixed 32-byte hex";
  }
  const c = body.credentials;
  if (!HEX_64.test(c.claimSecret)) return "credentials.claimSecret invalid";
  if (!HEX_64.test(c.claimSecretHash)) return "credentials.claimSecretHash invalid";
  if (!HEX_64.test(c.messageHash)) return "credentials.messageHash invalid";
  if (!/^\d+$/.test(c.messageLeafIndex)) return "credentials.messageLeafIndex invalid";
  const amountErr = validateAmount(c.claimAmount);
  if (amountErr) return amountErr;
  if (!AZTEC_ADDR.test(c.recipient)) return "credentials.recipient invalid";
  return null;
}

cleanupExpiredJobs();
setInterval(cleanupExpiredJobs, Math.min(JOB_TTL_MS, 5 * 60_000)).unref?.();

export function createApp(opts: { authToken: string; corsOrigins?: string[] }): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const corsOrigins = opts.corsOrigins ?? parseCorsOrigins();

  app.use("/*", createSecurityHeadersMiddleware());

  app.use(
    "/*",
    cors({
      origin: (origin) => {
        if (!origin) return corsOrigins.length === 0 ? "" : corsOrigins[0]!;
        if (corsOrigins.includes(origin)) return origin;
        if (corsOrigins.length === 0) return null;
        return null;
      },
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
      maxAge: 600,
    }),
  );

  app.use(
    "/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );

  app.use("/*", createApiAuthMiddleware(opts.authToken));

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
      return c.json({ error: redactSecrets(message) }, 404);
    }
  });

  /** L1 spend via HTTP is disabled (C-02 / H-01). Use CLI or the browser wallet. */
  app.post("/v1/bridge", async (c) => {
    return c.json(
      {
        error:
          "HTTP L1 bridging is disabled. Use the CLI (`pnpm cli`) or the web wallet flow. Do not send L1 private keys to the API.",
      },
      403,
    );
  });

  app.post("/v1/claim", async (c) => {
    const claimGate = isClaimEndpointEnabled();
    if (!claimGate.ok) {
      return c.json({ error: claimGate.error }, claimGate.status);
    }
    if (!checkRateLimit(clientKey(c))) {
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    if (runningJobs >= MAX_CONCURRENT_JOBS) {
      return c.json({ error: "too many concurrent jobs" }, 429);
    }

    let body: {
      network?: string;
      credentials: ClaimCredentials;
      callerAddress: string;
      l2SecretKey: string;
      salt?: string;
      signingKey?: string;
      l1PrivateKey?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const validationError = validateClaimBody(body);
    if (validationError) return c.json({ error: validationError }, 400);

    let networkId: string;
    try {
      networkId = resolveNetworkId(body.network);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: redactSecrets(message) }, 400);
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const job: PublicJobRecord = {
      id,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      request: { networkId, type: "claim", callerAddress: body.callerAddress },
    };
    saveJob(job);

    runningJobs += 1;
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
          // Never load L1_PRIVATE_KEY for claim jobs.
          secrets: loadRuntimeSecrets({ l1PrivateKey: undefined }),
        });
        job.result = {
          networkId,
          recipient: body.callerAddress,
          l2TxHash: result.l2TxHash,
          messageHash: body.credentials.messageHash,
          messageLeafIndex: body.credentials.messageLeafIndex,
          claimAmount: body.credentials.claimAmount,
        };
        job.status = "succeeded";
      } catch (err) {
        job.status = "failed";
        const message = err instanceof Error ? err.message : String(err);
        job.error = redactSecrets(message);
      }
      job.updatedAt = new Date().toISOString();
      saveJob(job);
      runningJobs = Math.max(0, runningJobs - 1);
    })();

    return c.json({ jobId: id, status: job.status }, 202);
  });

  app.get("/v1/jobs/:id", (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "not found" }, 404);
    const job = loadJob(id);
    if (!job) return c.json({ error: "not found" }, 404);
    return c.json(job);
  });

  return app;
}
