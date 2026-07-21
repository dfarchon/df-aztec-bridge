import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
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

function resolveSqliteWasm(): string {
  const candidates = [
    resolve(webDir, "node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm"),
    resolve(rootDir, "node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm"),
    resolve(rootDir, "packages/browser-sdk/node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // pnpm: dependency is nested under .pnpm, not hoisted to apps/web
  try {
    const fromWallets = createRequire(
      resolve(rootDir, "node_modules/@aztec/wallets/package.json"),
    );
    return fromWallets.resolve("@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm");
  } catch {
    // continue
  }

  try {
    const fromSdk = createRequire(resolve(rootDir, "packages/browser-sdk/package.json"));
    return fromSdk.resolve("@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm");
  } catch {
    // continue
  }

  const pnpmDir = resolve(rootDir, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    for (const dir of readdirSync(pnpmDir)) {
      if (!dir.startsWith("@aztec+sqlite3mc-wasm@")) continue;
      const p = resolve(
        pnpmDir,
        dir,
        "node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3.wasm",
      );
      if (existsSync(p)) return p;
    }
  }

  throw new Error(
    "sqlite3.wasm not found. Install deps so @aztec/sqlite3mc-wasm is available.",
  );
}

/**
 * PXE's sqlite worker loads `sqlite3.wasm` next to the worker script via
 * WebAssembly.instantiateStreaming. Vite does not emit that file by default,
 * so Vercel SPA rewrite returns index.html (text/html) → MIME error.
 */
function aztecSqliteWasmPlugin(): Plugin {
  const wasmName = "sqlite3.wasm";

  const serveWasm = (reqUrl: string | undefined, res: import("http").ServerResponse, next: () => void) => {
    if (!reqUrl || !reqUrl.split("?")[0]!.endsWith(`/${wasmName}`)) {
      next();
      return;
    }
    const src = resolveSqliteWasm();
    res.setHeader("Content-Type", "application/wasm");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(src).pipe(res);
  };

  return {
    name: "aztec-sqlite-wasm",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        serveWasm(req.url, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        serveWasm(req.url, res, next);
      });
    },
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir ?? resolve(webDir, "dist");
      const assetsDir = resolve(outDir, "assets");
      mkdirSync(assetsDir, { recursive: true });
      copyFileSync(resolveSqliteWasm(), resolve(assetsDir, wasmName));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const browserClaim = env.VITE_ENABLE_BROWSER_CLAIM === "true";
  const bbBrowser = resolveAztecBbBrowser();

  return {
    envDir: rootDir,
    assetsInclude: ["**/*.wasm"],
    plugins: [
      react(),
      nodePolyfills({
        include: ["buffer", "process", "path", "stream", "util", "crypto"],
      }),
      aztecSqliteWasmPlugin(),
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
