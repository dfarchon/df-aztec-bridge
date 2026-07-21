import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM === "true";

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
  setSplashHint("Loading app bundle…");
  const appPromise = import("./App.js");

  // Prefetch heavy claim stack in parallel with the UI chunk when enabled.
  const warmupPromise = warmupPxeIfEnabled();
  const [{ App }] = await Promise.all([appPromise, warmupPromise]);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  dismissBootSplash();
}

void boot();
