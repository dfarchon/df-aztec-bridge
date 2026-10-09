import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const marker = join(root, "packages/browser-sdk/dist/claim-lazy.js");

if (existsSync(marker)) {
  process.exit(0);
}

console.log(
  "packages/browser-sdk/dist is missing (it is gitignored). Building @df-bridge/browser-sdk…",
);
const result = spawnSync("pnpm", ["--filter", "@df-bridge/browser-sdk", "run", "build"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
