import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(webDir, "../..");

function resolvePinoBrowser(): string {
  const candidates = [
    resolve(webDir, "node_modules/pino/browser.js"),
    resolve(rootDir, "node_modules/pino/browser.js"),
    resolve(rootDir, "packages/browser-sdk/node_modules/pino/browser.js"),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (hit) return hit;

  try {
    const fromSdk = createRequire(resolve(rootDir, "packages/browser-sdk/package.json"));
    return fromSdk.resolve("pino/browser.js");
  } catch {
    // continue
  }

  const pnpmDir = resolve(rootDir, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    for (const dir of readdirSync(pnpmDir)) {
      if (!dir.startsWith("pino@")) continue;
      const p = resolve(pnpmDir, dir, "node_modules/pino/browser.js");
      if (existsSync(p)) return p;
    }
  }

  throw new Error("pino/browser.js not found. Install deps so pino is available.");
}

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
  const pinoBrowser = resolvePinoBrowser();

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
      alias: [
        { find: "@aztec/bb.js", replacement: bbBrowser },
        { find: "pino-browser-entry", replacement: pinoBrowser },
        {
          find: /^pino$/,
          replacement: resolve(webDir, "src/shims/pino-browser.ts"),
        },
      ],
    },
    optimizeDeps: {
      include: [
        // CJS packages the excluded Aztec graph imports as bare specifiers. Vite's raw
        // transform path serves CJS as-is, so the browser gets no named/default exports;
        // pre-bundling makes esbuild add the interop. `msgpackr` needs its no-eval build
        // named explicitly because @aztec/kv-store reaches it via the `#msgpackr` alias.
        "hash.js",
        "sha3",
        "assert",
        "msgpackr/index-no-eval",
        "lodash.chunk",
        "lodash.clonedeepwith",
        "lodash.times",
        "json-stringify-deterministic",
        "util",
        // Invisible to the initial scan: `buffer` is injected by nodePolyfills during
        // transform, and `pino-browser-entry` is only reached through the aliased pino
        // shim behind excluded Aztec packages. Without these, Vite discovers them on the
        // first page load and swaps the deps directory mid-flight, which aborts the
        // in-flight `import("./App.js")` in main.tsx.
        "buffer",
        "pino-browser-entry",
      ],
      // Every `@aztec/*` entry reachable at runtime must be listed here, subpaths
      // included — Vite matches exact specifiers, not package prefixes.
      //
      // Two reasons:
      //  1. @aztec/wallets, @aztec/pxe and @aztec/kv-store create module workers via
      //     `new URL(..., import.meta.url)`. The optimizer rewrites those URLs into
      //     `.vite/deps`, where the worker entry does not exist.
      //  2. Those same excluded packages re-import @aztec/foundation, @aztec/stdlib and
      //     @aztec/aztec.js from source. Pre-bundling the subpaths we import directly
      //     would give the page a second copy of Fr/Fq/AztecAddress, and passing an
      //     instance across copies fails the `instanceof BaseField` check with
      //     "Type 'object' ... passed to BaseField ctor".
      exclude: [
        "@aztec/bb.js",
        "@aztec/wallets",
        "@aztec/wallets/embedded",
        "@aztec/pxe",
        "@aztec/pxe/config",
        "@aztec/pxe/server",
        "@aztec/kv-store",
        "@aztec/kv-store/sqlite-opfs",
        "@aztec/sqlite3mc-wasm",
        "@aztec/aztec.js",
        "@aztec/aztec.js/addresses",
        "@aztec/aztec.js/contracts",
        "@aztec/aztec.js/crypto",
        "@aztec/aztec.js/ethereum",
        "@aztec/aztec.js/fee",
        "@aztec/aztec.js/messaging",
        "@aztec/aztec.js/node",
        "@aztec/aztec.js/protocol",
        "@aztec/aztec.js/wallet",
        "@aztec/ethereum/chain",
        "@aztec/ethereum/client",
        "@aztec/foundation",
        "@aztec/foundation/curves/bn254",
        "@aztec/foundation/json-rpc/client",
        "@aztec/foundation/log",
        "@aztec/foundation/retry",
        "@aztec/stdlib",
        "@aztec/stdlib/aztec-address",
        "@aztec/stdlib/interfaces/client",
        "@aztec/stdlib/keys",
        "@aztec/stdlib/messaging",
        "@aztec/stdlib/tx",
      ],
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
