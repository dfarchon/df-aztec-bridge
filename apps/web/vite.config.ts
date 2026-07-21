import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(webDir, "../..");

function resolveAztecBbBrowser(): string {
  const candidates = [
    resolve(webDir, "node_modules/@aztec/bb.js/dest/browser/index.js"),
    resolve(rootDir, "node_modules/@aztec/bb.js/dest/browser/index.js"),
    resolve(rootDir, "packages/browser-sdk/node_modules/@aztec/bb.js/dest/browser/index.js"),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(
      `@aztec/bb.js browser build not found. Tried:\n${candidates.join("\n")}`,
    );
  }
  return hit;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const browserClaim = env.VITE_ENABLE_BROWSER_CLAIM === "true";
  const bbBrowser = resolveAztecBbBrowser();

  return {
    envDir: rootDir,
    plugins: [
      react(),
      nodePolyfills({
        include: ["buffer", "process", "path", "stream", "util", "crypto"],
      }),
    ],
    resolve: {
      conditions: ["browser", "import", "module", "default"],
      alias: {
        "@aztec/bb.js": bbBrowser,
      },
    },
    optimizeDeps: {
      include: ["@aztec/bb.js"],
      exclude: browserClaim ? [] : ["@aztec/wallets", "@aztec/pxe"],
      esbuildOptions: {
        target: "esnext",
      },
    },
    build: {
      target: "esnext",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!browserClaim) return;
            if (id.includes("@aztec/") || id.includes("claim-browser")) {
              return "aztec-claim";
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      headers: browserClaim
        ? {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
          }
        : undefined,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    preview: {
      headers: browserClaim
        ? {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
          }
        : undefined,
    },
  };
});
