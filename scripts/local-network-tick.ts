/**
 * Keep Aztec local-network advancing while idle.
 *
 * Every LOCAL_TICK_INTERVAL_MS (default 16000): call aztecDebug_mineBlock so
 * AutomineSequencer publishes a checkpoint (empty or with pending txs).
 *
 *   pnpm tick:local
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const reqCore = createRequire(join(ROOT, "packages/core/package.json"));

const INTERVAL_MS = Math.max(
  1_000,
  Number(process.env.LOCAL_TICK_INTERVAL_MS ?? "16000") || 16_000,
);
const AZTEC_URL =
  process.env.LOCAL_AZTEC_NODE_URL ??
  process.env.VITE_LOCAL_AZTEC_NODE_URL ??
  "http://localhost:8080";

async function importDep(specifier: string) {
  return import(pathToFileURL(reqCore.resolve(specifier)).href);
}

async function waitForNode(url: string, maxAttempts = 180): Promise<void> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "node_getNodeInfo",
          params: [],
          id: 1,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { result?: unknown; error?: unknown };
        if (body.result && !body.error) {
          console.error(`Local Aztec node is up (attempt ${i}).`);
          return;
        }
      }
    } catch {
      /* retry */
    }
    if (i === maxAttempts) {
      throw new Error(`Timed out waiting for Aztec at ${url}`);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

async function main() {
  console.error(`Local network tick → ${AZTEC_URL} every ${INTERVAL_MS}ms`);
  await waitForNode(AZTEC_URL);

  const { createAztecNodeClient } = await importDep("@aztec/aztec.js/node");
  const { createAztecNodeDebugClient } = await importDep(
    "@aztec/stdlib/interfaces/client",
  );

  const node = createAztecNodeClient(AZTEC_URL);
  const debug = createAztecNodeDebugClient(AZTEC_URL);

  let tick = 0;
  for (;;) {
    tick += 1;
    const started = Date.now();
    try {
      // Prefer explicit mine (forces AutomineSequencer to build/publish).
      if (typeof debug.mineBlock === "function") {
        await debug.mineBlock();
        console.error(`[tick ${tick}] mineBlock ok (${Date.now() - started}ms)`);
      } else {
        const { slotDuration } = await node.getL1Constants();
        const warpSec = Math.max(1, Math.min(Number(slotDuration) || 36, 36));
        await debug.warpL2TimeAtLeastBy(warpSec);
        console.error(
          `[tick ${tick}] warpL2TimeAtLeastBy(${warpSec}s) ok (${Date.now() - started}ms)`,
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[tick ${tick}] FAILED: ${msg}`);
      // Fallback warp if mineBlock unsupported / flaky on this build.
      try {
        const { slotDuration } = await node.getL1Constants();
        const warpSec = Math.max(1, Math.min(Number(slotDuration) || 16, 16));
        await debug.warpL2TimeAtLeastBy(warpSec);
        console.error(`[tick ${tick}] fallback warp(${warpSec}s) ok`);
      } catch (e2: unknown) {
        console.error(
          `[tick ${tick}] fallback warp FAILED: ${e2 instanceof Error ? e2.message : String(e2)}`,
        );
      }
    }

    const elapsed = Date.now() - started;
    const sleepMs = Math.max(0, INTERVAL_MS - elapsed);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
