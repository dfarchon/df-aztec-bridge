import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import "./styles.css";

if (import.meta.env.PROD) {
  inject({ framework: "react" });
}

const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM !== "false";
const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";

function setSplashHint(text: string) {
  const el = document.querySelector(".boot-splash-hint");
  if (el) el.textContent = text;
}

function dismissBootSplash() {
  const el = document.getElementById("boot-splash");
  if (!el) return;
  el.classList.add("boot-splash-leave");
  el.setAttribute("aria-busy", "false");
  window.setTimeout(() => el.remove(), 280);
}

/**
 * A failed chunk request leaves the splash spinning forever with nothing but a
 * console error, so surface it with a way out. In dev this is usually a stale
 * Vite dep cache; in production it is a chunk removed by a newer deploy.
 */
function showBootFailure(error: unknown) {
  console.error("[boot] Failed to start the app", error);

  const splash = document.getElementById("boot-splash");
  const inner = splash?.querySelector(".boot-splash-inner");
  if (!splash || !inner) return;

  splash.setAttribute("aria-busy", "false");
  splash.querySelector(".boot-spinner")?.remove();

  const hint = splash.querySelector(".boot-splash-hint");
  if (hint) {
    hint.textContent =
      error instanceof Error && /dynamically imported module|Importing a module/i.test(error.message)
        ? "Could not load the app bundle. This is usually a stale cache — reload to fetch a fresh copy."
        : `Could not start the app: ${error instanceof Error ? error.message : String(error)}`;
  }

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Reload";
  retry.style.cssText =
    "padding:0.5rem 1.25rem;border-radius:0.375rem;border:1px solid #3d5afe;" +
    "background:#3d5afe;color:#fff;font:600 0.85rem system-ui,sans-serif;cursor:pointer";
  retry.addEventListener("click", () => window.location.reload());
  inner.appendChild(retry);
}

async function warmupPxeIfEnabled() {
  if (!BROWSER_CLAIM) return;

  setSplashHint("Loading Aztec claim runtime…");
  const [{ loadBrowserClaim }, { DEFAULT_NETWORK_ID, getNetwork }, { getRpcOverrides }] =
    await Promise.all([
      import("@df-bridge/browser-sdk/claim-lazy"),
      import("./config/networks.js"),
      import("./lib/rpc-overrides.js"),
    ]);

  const { warmupBrowserClaim } = await loadBrowserClaim();
  const networkId = DEFAULT_NETWORK_ID;
  const base = getNetwork(networkId);
  const overrides = getRpcOverrides(networkId);
  const aztecNodeUrl = overrides.aztecNodeUrl?.trim() || base.aztecNodeUrl;

  const startedAt = Date.now();
  const heartbeat = window.setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    setSplashHint(`Initializing EmbeddedWallet / PXE… ${secs}s (first visit can take minutes)`);
  }, 1_000);

  try {
    await warmupBrowserClaim({
      networkId,
      aztecNodeUrl,
      onProgress: (detail) => {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        setSplashHint(`${detail} (${secs}s)`);
      },
    });
    setSplashHint("PXE ready — opening app…");
  } catch (e: unknown) {
    console.warn("[boot] PXE warmup failed; claim will retry on demand", e);
    setSplashHint("PXE warmup failed — you can still bridge; claim will retry later.");
    await new Promise((r) => setTimeout(r, 900));
  } finally {
    window.clearInterval(heartbeat);
  }
}

async function boot() {
  if (MAINTENANCE_MODE) {
    setSplashHint("Checking service status…");
    const { MaintenancePage } = await import("./MaintenancePage.js");
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <MaintenancePage />
      </StrictMode>,
    );
    dismissBootSplash();
    return;
  }

  setSplashHint("Loading app bundle…");
  const { App } = await import("./App.js");
  await warmupPxeIfEnabled();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  dismissBootSplash();
}

void boot().catch(showBootFailure);
