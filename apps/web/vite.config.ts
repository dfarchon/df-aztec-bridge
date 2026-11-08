import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDevCsp } from "./src/lib/csp.ts";
import { assertPinnedFeeRecipient } from "./src/lib/fee-recipient.ts";
import { assertPinnedSponsoredFpc } from "./src/lib/sponsored-fpc.ts";
import { assertSafeConfiguredRpcUrl, isSafeConfiguredRpcUrl } from "./src/lib/official-links.ts";

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
    resolve(webDir, "node_modules/@aztec-foundation/bb.js/dest/browser/index.js"),
    resolve(rootDir, "node_modules/@aztec-foundation/bb.js/dest/browser/index.js"),
    resolve(rootDir, "packages/browser-sdk/node_modules/@aztec-foundation/bb.js/dest/browser/index.js"),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(
      `@aztec-foundation/bb.js browser build not found. Tried:\n${candidates.join("\n")}`,
    );
  }
  return hit;
}

function resolveSqliteJswasmFile(fileName: string): string {
  const candidates = [
    resolve(webDir, "node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm", fileName),
    resolve(rootDir, "node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm", fileName),
    resolve(rootDir, "packages/browser-sdk/node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm", fileName),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // pnpm: dependency is nested under .pnpm, not hoisted to apps/web
  try {
    const fromWallets = createRequire(
      resolve(rootDir, "node_modules/@aztec-labs/wallets/package.json"),
    );
    return fromWallets.resolve(`@aztec-labs/sqlite3mc-wasm/vendor/jswasm/${fileName}`);
  } catch {
    // continue
  }

  try {
    const fromSdk = createRequire(resolve(rootDir, "packages/browser-sdk/package.json"));
    return fromSdk.resolve(`@aztec-labs/sqlite3mc-wasm/vendor/jswasm/${fileName}`);
  } catch {
    // continue
  }

  const pnpmDir = resolve(rootDir, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    for (const dir of readdirSync(pnpmDir)) {
      if (!dir.startsWith("@aztec-labs+sqlite3mc-wasm@")) continue;
      const p = resolve(
        pnpmDir,
        dir,
        "node_modules/@aztec-labs/sqlite3mc-wasm/vendor/jswasm",
        fileName,
      );
      if (existsSync(p)) return p;
    }
  }

  throw new Error(
    `${fileName} not found. Install deps so @aztec-labs/sqlite3mc-wasm is available.`,
  );
}

/**
 * PXE's sqlite OPFS worker loads `sqlite3.wasm` and `sqlite3-opfs-async-proxy.js`
 * next to the hashed worker under assetsDir (`a/`). Vite does not emit those files
 * by default, so Netlify SPA fallback returns index.html (text/html) → MIME error.
 */
function aztecSqliteWasmPlugin(): Plugin {
  const assetFiles: Array<{ name: string; contentType: string }> = [
    { name: "sqlite3.wasm", contentType: "application/wasm" },
    { name: "sqlite3-opfs-async-proxy.js", contentType: "application/javascript; charset=utf-8" },
  ];

  const serveSqliteAsset = (
    reqUrl: string | undefined,
    res: import("http").ServerResponse,
    next: () => void,
  ) => {
    if (!reqUrl) {
      next();
      return;
    }
    const pathOnly = reqUrl.split("?")[0]!;
    const asset = assetFiles.find((a) => pathOnly.endsWith(`/${a.name}`));
    if (!asset) {
      next();
      return;
    }
    const src = resolveSqliteJswasmFile(asset.name);
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Cache-Control", "no-cache");
    createReadStream(src).pipe(res);
  };

  return {
    name: "aztec-sqlite-wasm",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      // The async OPFS and opfs-wl VFS installers spawn a worker that fails under Vite
      // and only console.errors. The kv store uses an in-memory DB or the SAH pool.
      if (file.includes("sqlite3mc-wasm") && file.endsWith("/sqlite3.mjs") && !code.includes("df-bridge:skip-unused-opfs")) {
        return {
          code:
            "/* df-bridge:skip-unused-opfs */\n" +
            "globalThis.sqlite3ApiConfig ??= {};\n" +
            "globalThis.sqlite3ApiConfig.disable ??= {};\n" +
            "globalThis.sqlite3ApiConfig.disable.vfs ??= {};\n" +
            "globalThis.sqlite3ApiConfig.disable.vfs.opfs = true;\n" +
            'globalThis.sqlite3ApiConfig.disable.vfs["opfs-wl"] = true;\n' +
            code,
          map: null,
        };
      }
      // Wallet and node streams attach a few more than the events default of 10 during boot.
      if (file.endsWith("/events/events.js") && code.includes("var defaultMaxListeners = 10;")) {
        return {
          code: code.replace(
            "var defaultMaxListeners = 10;",
            "var defaultMaxListeners = 32; /* df-bridge:max-listeners */",
          ),
          map: null,
        };
      }
      return undefined;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        serveSqliteAsset(req.url, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        serveSqliteAsset(req.url, res, next);
      });
    },
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir ?? resolve(webDir, "dist");
      // Match production assetsDir ("a") so workers can fetch sibling sqlite assets.
      const assetsDir = resolve(outDir, "a");
      mkdirSync(assetsDir, { recursive: true });
      for (const asset of assetFiles) {
        copyFileSync(resolveSqliteJswasmFile(asset.name), resolve(assetsDir, asset.name));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const browserClaim = env.VITE_ENABLE_BROWSER_CLAIM !== "false";
  const bbBrowser = resolveAztecBbBrowser();
  const pinoBrowser = resolvePinoBrowser();
  const apiAuthToken = env.API_AUTH_TOKEN?.trim() ?? "";
  const rawDevMainnetNode =
    mode === "development" ? (env.MAINNET_AZTEC_NODE_URL?.trim() ?? "") : "";
  const devMainnetNode =
    rawDevMainnetNode && isSafeConfiguredRpcUrl(rawDevMainnetNode) ? rawDevMainnetNode : "";
  if (!browserClaim && !apiAuthToken) {
    throw new Error(
      "VITE_ENABLE_BROWSER_CLAIM=false requires API_AUTH_TOKEN (≥32) so the /api proxy can authenticate /v1/claim.",
    );
  }
  if (!browserClaim && apiAuthToken.length > 0 && apiAuthToken.length < 32) {
    throw new Error("API_AUTH_TOKEN must be at least 32 characters.");
  }
  if (!browserClaim && env.API_ENABLE_CLAIM !== "true") {
    throw new Error(
      "VITE_ENABLE_BROWSER_CLAIM=false requires API_ENABLE_CLAIM=true on the local API (loopback only). Prefer browser claim for Netlify.",
    );
  }
  assertPinnedFeeRecipient(env.VITE_BRIDGE_FEE_RECIPIENT);
  assertPinnedSponsoredFpc(env.VITE_SPONSORED_FPC_ADDRESS);
  if (env.VITE_BRIDGE_ETH_FEE_WEI?.trim()) {
    throw new Error(
      "VITE_BRIDGE_ETH_FEE_WEI is removed. Mainnet ETH service fee is always gasPrice × ~1 L1 tx gas.",
    );
  }
  for (const key of [
    "VITE_MAINNET_AZTEC_NODE_URL",
    "VITE_MAINNET_L1_RPC_URL",
    "VITE_TESTNET_AZTEC_NODE_URL",
    "VITE_TESTNET_L1_RPC_URL",
    "VITE_LOCAL_AZTEC_NODE_URL",
    "VITE_LOCAL_L1_RPC_URL",
  ]) {
    const value = env[key]?.trim();
    if (value) assertSafeConfiguredRpcUrl(value, key);
  }

  const viteApiBase = env.VITE_API_BASE?.trim() || "/api";
  if (
    viteApiBase !== "/api" &&
    !viteApiBase.startsWith("/api/") &&
    !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(viteApiBase)
  ) {
    throw new Error(
      "VITE_API_BASE must be /api or a loopback http(s) URL. Remote claim API bases are blocked " +
        "(would require baking API_AUTH_TOKEN into the client). Prefer VITE_ENABLE_BROWSER_CLAIM=true.",
    );
  }

  return {
    envDir: rootDir,
    define: {
      "import.meta.env.DEV_MAINNET_AZTEC_NODE_URL": JSON.stringify(devMainnetNode),
      // Drop leftover preview-gate env. Vite inlines every VITE_ name it loads.
      "import.meta.env.VITE_DEV_GATE": "undefined",
      "import.meta.env.VITE_DEV_GATE_PASSWORD_HASH": "undefined",
    },
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
        { find: "@aztec-foundation/bb.js", replacement: bbBrowser },
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
        // named explicitly because @aztec-labs/kv-store reaches it via the `#msgpackr` alias.
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
        // in-flight `import("./App.tsx")` in main.tsx.
        "buffer",
        "pino-browser-entry",
      ],
      // Every `@aztec-labs/*` entry reachable at runtime must be listed here, subpaths
      // included — Vite matches exact specifiers, not package prefixes.
      //
      // Two reasons:
      //  1. @aztec-labs/wallets, @aztec-labs/pxe and @aztec-labs/kv-store create module workers via
      //     `new URL(..., import.meta.url)`. The optimizer rewrites those URLs into
      //     `.vite/deps`, where the worker entry does not exist.
      //  2. Those same excluded packages re-import @aztec-labs/foundation, @aztec-labs/stdlib and
      //     @aztec-labs/aztec.js from source. Pre-bundling the subpaths we import directly
      //     would give the page a second copy of Fr/Fq/AztecAddress, and passing an
      //     instance across copies fails the `instanceof BaseField` check with
      //     "Type 'object' ... passed to BaseField ctor".
      exclude: [
        "@aztec-foundation/bb.js",
        "@aztec-labs/wallets",
        "@aztec-labs/wallets/embedded",
        "@aztec-labs/wallet-sdk",
        "@aztec-labs/wallet-sdk/manager",
        "@aztec-labs/wallet-sdk/crypto",
        "@aztec-labs/pxe",
        "@aztec-labs/pxe/config",
        "@aztec-labs/pxe/server",
        "@aztec-labs/kv-store",
        "@aztec-labs/kv-store/sqlite-opfs",
        "@aztec-labs/sqlite3mc-wasm",
        "@aztec-labs/aztec.js",
        "@aztec-labs/aztec.js/addresses",
        "@aztec-labs/aztec.js/contracts",
        "@aztec-labs/aztec.js/crypto",
        "@aztec-labs/aztec.js/ethereum",
        "@aztec-labs/aztec.js/fee",
        "@aztec-labs/aztec.js/messaging",
        "@aztec-labs/aztec.js/node",
        "@aztec-labs/aztec.js/protocol",
        "@aztec-labs/aztec.js/wallet",
        "@aztec-labs/aztec.js/utils",
        "@aztec-labs/ethereum/chain",
        "@aztec-labs/ethereum/client",
        "@aztec-labs/foundation",
        "@aztec-labs/foundation/curves/bn254",
        "@aztec-labs/foundation/json-rpc/client",
        "@aztec-labs/foundation/log",
        "@aztec-labs/foundation/retry",
        "@aztec-labs/stdlib",
        "@aztec-labs/stdlib/aztec-address",
        "@aztec-labs/stdlib/interfaces/client",
        "@aztec-labs/stdlib/keys",
        "@aztec-labs/stdlib/messaging",
        "@aztec-labs/stdlib/tx",
      ],
      esbuildOptions: {
        target: "esnext",
      },
    },
    build: {
      target: "esnext",
      // Never ship original TypeScript / readable maps to browsers (F12 Sources).
      sourcemap: false,
      minify: "esbuild",
      cssMinify: true,
      // Opaque hashed filenames — no readable module path leaks in Network tab.
      assetsDir: "a",
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          entryFileNames: "a/[hash].js",
          chunkFileNames: "a/[hash].js",
          assetFileNames: "a/[hash][extname]",
          manualChunks(id) {
            if (!browserClaim) return;
            if (
              id.includes("@aztec-labs/") ||
              id.includes("@aztec-foundation/") ||
              id.includes("claim-browser")
            ) {
              return "aztec-claim";
            }
          },
        },
      },
    },
    esbuild: {
      legalComments: "none",
      // Strip console / debugger from production bundles (reduces F12 Console signal).
      drop: mode === "production" ? ["console", "debugger"] : [],
    },
    server: {
      port: 5173,
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        // credentialless keeps cross-origin isolation (SharedArrayBuffer / PXE WASM)
        // without require-corp, which commonly breaks MetaMask / Brave wallet popups.
        "Cross-Origin-Embedder-Policy": browserClaim ? "credentialless" : "unsafe-none",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
        "Content-Security-Policy": buildDevCsp({ unsafeInlineScripts: true }),
      },
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (!apiAuthToken) return;
              if (!proxyReq.getHeader("authorization") && !proxyReq.getHeader("x-api-key")) {
                proxyReq.setHeader("Authorization", `Bearer ${apiAuthToken}`);
              }
            });
          },
        },
      },
    },
    preview: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": browserClaim ? "credentialless" : "unsafe-none",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
        "Content-Security-Policy": buildDevCsp({ unsafeInlineScripts: false }),
      },
    },
  };
});
