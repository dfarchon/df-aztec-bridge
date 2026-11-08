import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { hardenClientSurface } from "./lib/client-hardening.ts";
import { AsciiField } from "./theme/AsciiField.tsx";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import "./styles.css";

// Production: mute console + resist trivial inject helpers (before app boot).
hardenClientSurface();

const BROWSER_CLAIM = import.meta.env.VITE_ENABLE_BROWSER_CLAIM !== "false";
const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";

// These are estimates: PXE initialization does not expose byte-level progress.
let splashProgress = 3;
let progressCeiling = 18;
let progressStep = 0.08;
let progressFrame = 0;
const reduceSplashMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function updateSplashProgress(value: number) {
  splashProgress = Math.max(splashProgress, Math.min(100, value));
  const displayed = Math.floor(splashProgress);
  const bar = document.querySelector<HTMLElement>(".boot-spinner");
  bar?.setAttribute("aria-valuenow", String(displayed));
  const filled = Math.floor(displayed * 40 / 100);
  const active = Array.from({ length: filled }, (_, index) =>
    displayed < 100 && !reduceSplashMotion.matches && (index - progressFrame + 40) % 5 === 0 ? "." : ">",
  ).join("");
  const chars = bar?.querySelector<HTMLElement>(".boot-progress-characters");
  const label = bar?.querySelector<HTMLElement>(".boot-progress-label");
  if (chars) {
    const symbols = `[${active}${"-".repeat(40 - filled)}]`;
    Array.from(chars.children).forEach((child, index) => { child.textContent = symbols[index]; });
  }
  if (label) label.textContent = `~${displayed}%`;
}
function setProgressStage(start: number, ceiling: number, step: number) {
  progressCeiling = ceiling;
  progressStep = step;
  updateSplashProgress(start);
}
const splashProgressTimer = window.setInterval(() => {
  progressFrame = (progressFrame + 1) % 5;
  updateSplashProgress(splashProgress + Math.max(0, progressCeiling - splashProgress) * progressStep);
}, 500);

function setSplashHint(text: string) {
  const hint = document.querySelector(".boot-splash-hint");
  const note = document.querySelector(".boot-splash-note");
  const match = text.match(/^(.*?)(?:\s+(\([^)]*\)))?$/);
  const lead = match?.[1]?.trim() || text;
  const aside = match?.[2] ?? "";
  if (hint) hint.textContent = lead;
  if (note instanceof HTMLElement) {
    note.textContent = aside;
    note.hidden = aside.length === 0;
  }
}

document.getElementById("boot-reload")?.addEventListener("click", () => window.location.reload());

const bootField = document.getElementById("boot-field");
if (bootField) {
  createRoot(bootField).render(
    <StrictMode>
      <AsciiField />
    </StrictMode>,
  );
}

function dismissBootSplash(targetKind: "connect" | "wallet-step" | "none" = "none") {
  window.clearInterval(splashProgressTimer);
  updateSplashProgress(100);
  const el = document.getElementById("boot-splash");
  if (!el) return;
  el.setAttribute("aria-busy", "false");
  window.setTimeout(() => {
    const card = el.querySelector<HTMLElement>(".boot-splash-inner");
    const target = targetKind === "none" ? null : document.querySelector<HTMLElement>(
      targetKind === "wallet-step" ? "[data-boot-wallet-step]" : "[data-boot-connect-wallet]",
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!card || !target || reducedMotion) {
      document.documentElement.removeAttribute("data-booting");
      el.classList.add("boot-splash-leave");
      window.setTimeout(() => el.remove(), reducedMotion ? 0 : 280);
      return;
    }

    const from = card.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) {
      document.documentElement.removeAttribute("data-booting");
      el.classList.add("boot-splash-leave");
      window.setTimeout(() => el.remove(), 280);
      return;
    }
    const targetStyle = window.getComputedStyle(target);
    const previousOpacity = target.style.opacity;
    target.style.opacity = "0";
    Object.assign(card.style, {
      position: "fixed",
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      maxWidth: "none",
      overflow: "hidden",
      margin: "0",
    });
    const oldContent = Array.from(card.children) as HTMLElement[];
    for (const child of oldContent) {
      child.animate([{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], {
        duration: 600,
        fill: "forwards",
      });
    }
    const label = document.createElement("span");
    label.textContent = targetKind === "wallet-step" ? "Aztec account" : "Connect wallet";
    Object.assign(label.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      whiteSpace: "nowrap",
      font: targetStyle.font,
      color: targetStyle.color,
      letterSpacing: targetStyle.letterSpacing,
      opacity: "0",
    });
    card.append(label);
    label.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], {
      duration: 600,
      fill: "forwards",
    });
    const animation = card.animate(
      [
        { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` },
        {
          left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
          borderRadius: targetStyle.borderRadius,
          borderColor: targetStyle.borderColor,
          background: targetStyle.backgroundColor,
          boxShadow: targetStyle.boxShadow,
        },
      ],
      { duration: 600, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
    void animation.finished.catch(() => {}).finally(() => {
      target.style.opacity = previousOpacity;
      document.documentElement.removeAttribute("data-booting");
      if (targetKind === "wallet-step") {
        target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
        void card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" })
          .finished.catch(() => {}).finally(() => el.remove());
      } else {
        el.remove();
      }
    });
  }, 300);
}

async function restoreWalletBeforeLaunch(): Promise<ConnectedWallet | null> {
  try {
    const [{ discoverWallets }, { DEFAULT_NETWORK_ID, getNetwork }, reconnect] = await Promise.all([
      import("@df-bridge/browser-sdk"),
      import("./config/networks.ts"),
      import("./lib/wallet-reconnect.ts"),
    ]);
    const remembered = reconnect.getRememberedConnector();
    if (remembered === reconnect.DISCONNECTED_CONNECTOR || remembered === "walletconnect") return null;
    // Allow late EIP-6963 announcements before deciding whether a wallet is unambiguous.
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    const wallets = await discoverWallets(200);
    const wallet = await reconnect.findAuthorizedWallet(wallets, remembered, getNetwork(DEFAULT_NETWORK_ID).l1ChainId);
    if (wallet?.rdns) reconnect.rememberConnector(wallet.rdns);
    return wallet;
  } catch {
    return null;
  }
}

/**
 * A failed chunk request leaves the splash spinning forever with nothing but a
 * console error, so surface it with a way out. In dev this is usually a stale
 * Vite dep cache; in production it is a chunk removed by a newer deploy.
 */
function showBootFailure(error: unknown) {
  window.clearInterval(splashProgressTimer);
  console.error("[boot] Failed to start the app", error);

  const splash = document.getElementById("boot-splash");
  const inner = splash?.querySelector(".boot-splash-inner");
  if (!splash || !inner) return;

  splash.setAttribute("aria-busy", "false");
  splash.querySelector(".boot-spinner")?.remove();

  splash.querySelector(".boot-splash-copy")?.classList.add("is-error");
  const note = splash.querySelector(".boot-splash-note");
  if (note instanceof HTMLElement) note.hidden = true;
  const hint = splash.querySelector(".boot-splash-hint");
  if (hint) {
    hint.textContent =
      error instanceof Error && /dynamically imported module|Importing a module/i.test(error.message)
        ? "Could not load the app bundle. This is usually a stale cache — reload to fetch a fresh copy."
        : `Could not start the app: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function warmupPxeIfEnabled() {
  if (!BROWSER_CLAIM) return;

  setProgressStage(25, 42, 0.025);
  setSplashHint("Loading Aztec claim runtime…");
  const [{ loadBrowserClaim }, { DEFAULT_NETWORK_ID, getNetwork }, { getRpcOverrides }] =
    await Promise.all([
      import("@df-bridge/browser-sdk/claim-lazy"),
      import("./config/networks.ts"),
      import("./lib/rpc-overrides.ts"),
    ]);

  const { warmupBrowserClaim } = await loadBrowserClaim();
  const networkId = DEFAULT_NETWORK_ID;
  const base = getNetwork(networkId);
  const overrides = await getRpcOverrides(networkId);
  const aztecNodeUrl = overrides.aztecNodeUrl?.trim() || base.aztecNodeUrl;

  const startedAt = Date.now();
  setProgressStage(45, 94, 0.008);
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
        setSplashHint(`${detail} ${secs}s`);
      },
    });
    setSplashHint("PXE ready — opening app…");
  } catch (e: unknown) {
    console.warn("[boot] PXE warmup failed; claim will retry on demand", e);
    setSplashHint("PXE warmup failed — you can still bridge; claim will retry later.");
    try {
      const { logDappError, pushDappLog } = await import("./lib/dapp-log.ts");
      logDappError(e, "PXE warmup failed");
      pushDappLog({
        kind: "announce",
        title: "You can still connect and bridge",
        detail: "Import → PXE will retry circuit download when you import a DF account.",
      });
    } catch {
      /* toaster not critical during boot */
    }
    await new Promise((r) => setTimeout(r, 900));
  } finally {
    window.clearInterval(heartbeat);
  }
}

async function boot() {
  const { assertNoLocalizationSideChannels } = await import("./lib/privacy.ts");
  const { discardLegacyPlaintextSecrets } = await import("./lib/vault.ts");
  assertNoLocalizationSideChannels();
  if (discardLegacyPlaintextSecrets() > 0) {
    const { pushAppError } = await import("./lib/app-error-toast.ts");
    pushAppError({
      title: "Removed old browser storage",
      detail:
        "Unencrypted recovery data from this browser was deleted. Import your claim JSON if a claim is still open, then unlock the vault.",
    });
  }

  if (import.meta.env.PROD && typeof window !== "undefined" && window.location.protocol === "http:") {
    const host = window.location.hostname.toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (!loopback) {
      setSplashHint("HTTPS required…");
      const { HttpsRequiredPage } = await import("./components/ui/HttpsRequiredPage.tsx");
      createRoot(document.getElementById("root")!).render(
        <StrictMode>
          <HttpsRequiredPage />
        </StrictMode>,
      );
      dismissBootSplash();
      return;
    }
  }

  if (MAINTENANCE_MODE) {
    setProgressStage(30, 90, 0.03);
    setSplashHint("Checking service status…");
    const { MaintenancePage } = await import("./components/ui/MaintenancePage.tsx");
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <MaintenancePage />
      </StrictMode>,
    );
    dismissBootSplash();
    return;
  }

  setSplashHint("Loading app bundle…");
  setProgressStage(10, 25, 0.04);
  const { App } = await import("./app/App.tsx");
  const [, initialWallet] = await Promise.all([warmupPxeIfEnabled(), restoreWalletBeforeLaunch()]);

  setProgressStage(97, 99, 0.1);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App initialWallet={initialWallet} />
    </StrictMode>,
  );
  dismissBootSplash(initialWallet ? "wallet-step" : "connect");
}

void boot().catch(showBootFailure);
