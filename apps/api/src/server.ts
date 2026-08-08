import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import {
  isLoopbackHost,
  parseCorsOrigins,
  requireApiAuthToken,
} from "./security.ts";

const auth = requireApiAuthToken();
if (!auth.ok) {
  console.error(auth.error);
  process.exit(1);
}

const corsOrigins = parseCorsOrigins();
const app = createApp({ authToken: auth.token, corsOrigins });

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 8787);

if (!isLoopbackHost(host) && process.env.API_ALLOW_NON_LOOPBACK !== "true") {
  console.error(
    `Refusing to bind API to non-loopback host ${host}. Set API_HOST=127.0.0.1 or API_ALLOW_NON_LOOPBACK=true (not recommended).`,
  );
  process.exit(1);
}

if (!isLoopbackHost(host)) {
  console.warn(
    "WARNING: API bound to a non-loopback interface. Ensure network controls, CORS_ORIGINS, API_AUTH_TOKEN, and that L1 keys are never exposed.",
  );
  if (process.env.API_TRUST_PROXY !== "true") {
    console.warn(
      "WARNING: API_TRUST_PROXY is not true — X-Forwarded-For is ignored for rate limits (recommended unless a trusted proxy strips/spoofs client IPs).",
    );
  }
}

console.error(`API listening on http://${host}:${port}`);
console.error(
  `CORS origins: ${corsOrigins.length ? corsOrigins.join(", ") : "(default-deny / no browser cross-origin)"}`,
);
console.error("Auth: API_AUTH_TOKEN required on /v1/* (Authorization: Bearer … or X-API-Key)");
if (process.env.API_ENABLE_CLAIM === "true") {
  console.error("Claim: API_ENABLE_CLAIM=true (L2 secrets accepted on loopback only)");
} else {
  console.error("Claim: API_ENABLE_CLAIM unset — POST /v1/claim returns 403 (prefer browser claim)");
}

serve({ fetch: app.fetch, hostname: host, port });
