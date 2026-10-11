#!/usr/bin/env node
/**
 * Block npm/yarn installs. Require engines.node and Corepack-pinned pnpm.
 * Used as root package.json#scripts.preinstall — no extra dependencies.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pm = String(pkg.packageManager || "");
const wantPnpm = pm.split("@")[1]?.split("+")[0] || "";
const wantNode = String(pkg.engines?.node || "");
const runningNode = process.versions.node;
const ua = process.env.npm_config_user_agent || "";

if (!/^\d+\.\d+\.\d+$/.test(wantNode)) {
  console.error(
    `[enforce-pnpm] package.json#engines.node must be an exact version (got ${wantNode || "empty"})`,
  );
  process.exit(1);
}

if (runningNode !== wantNode) {
  console.error(
    `[enforce-pnpm] Node version mismatch: running ${runningNode}, require ${wantNode} (package.json#engines.node).`,
  );
  process.exit(1);
}

if (!/^pnpm@\d+\.\d+\.\d+\+sha512\.[a-f0-9]{128}$/.test(pm)) {
  console.error(
    `[enforce-pnpm] package.json#packageManager must be pnpm@<ver>+sha512.<128-hex> (got ${pm || "empty"})`,
  );
  process.exit(1);
}

if (!/\bpnpm\//.test(ua)) {
  console.error(
    `[enforce-pnpm] Use pnpm only (got user-agent: ${ua || "unknown"}).\n` +
      `  corepack enable\n` +
      `  corepack prepare "${pm}" --activate\n` +
      `  pnpm install --frozen-lockfile`,
  );
  process.exit(1);
}

const runningPnpm = ua.match(/\bpnpm\/(\d+\.\d+\.\d+)/)?.[1];
if (runningPnpm && wantPnpm && runningPnpm !== wantPnpm) {
  console.error(
    `[enforce-pnpm] pnpm version mismatch: running ${runningPnpm}, require ${wantPnpm} (sha512-pinned).`,
  );
  process.exit(1);
}

process.exit(0);
