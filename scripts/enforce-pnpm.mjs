#!/usr/bin/env node
/**
 * Block npm/yarn installs. Require Corepack-pinned pnpm (packageManager sha512).
 * Used as root package.json#scripts.preinstall — no extra dependencies.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pm = String(pkg.packageManager || "");
const wantVer = pm.split("@")[1]?.split("+")[0] || "";
const ua = process.env.npm_config_user_agent || "";

if (!/^pnpm@10\.33\.2\+sha512\.[a-f0-9]{128}$/.test(pm)) {
  console.error(
    `[enforce-pnpm] package.json#packageManager must be pnpm@10.33.2+sha512.<128-hex> (got ${pm || "empty"})`,
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

const running = ua.match(/\bpnpm\/(\d+\.\d+\.\d+)/)?.[1];
if (running && wantVer && running !== wantVer) {
  console.error(
    `[enforce-pnpm] pnpm version mismatch: running ${running}, require ${wantVer} (sha512-pinned).`,
  );
  process.exit(1);
}

process.exit(0);
