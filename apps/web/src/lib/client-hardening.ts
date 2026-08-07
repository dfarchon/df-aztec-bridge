/**
 * Production client surface hardening.
 *
 * Browsers must download JS — DevTools can always open Sources. We harden what we can:
 * - no source maps / minified opaque chunks (vite.config)
 * - mute console exfiltration channels
 * - watch for unexpected remote <script> injects (CSP is the real block)
 *
 * Do NOT seal window.eval / Function — wallet + Aztec SDKs may need them.
 */

const PROD = import.meta.env.PROD;

function muteConsole(): void {
  if (!PROD || typeof console === "undefined") return;
  const noop = () => undefined;
  const methods = [
    "log",
    "debug",
    "info",
    "warn",
    "trace",
    "dir",
    "dirxml",
    "table",
    "group",
    "groupCollapsed",
    "groupEnd",
    "time",
    "timeEnd",
    "timeLog",
  ] as const;
  for (const m of methods) {
    try {
      Object.defineProperty(console, m, {
        configurable: false,
        writable: false,
        value: noop,
      });
    } catch {
      try {
        (console as unknown as Record<string, unknown>)[m] = noop;
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Observe late <script> injects. CSP script-src should already reject them;
 * this only surfaces a redacted toast if our log bus is loaded.
 */
function watchScriptInjection(): void {
  if (!PROD || typeof MutationObserver === "undefined" || typeof document === "undefined") {
    return;
  }
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLScriptElement)) continue;
        const src = node.src || "";
        // Allow same-origin module/worker scripts Vite emits.
        if (!src || src.startsWith(window.location.origin) || src.startsWith("/")) continue;
        void import("./dapp-log.ts")
          .then(({ pushDappLog }) => {
            pushDappLog({
              kind: "error",
              title: "Blocked unexpected script",
              detail: "A non-app script node was injected into the page (CSP should reject it).",
            });
          })
          .catch(() => undefined);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function hardenClientSurface(): void {
  if (!PROD) return;
  muteConsole();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => watchScriptInjection(), { once: true });
  } else {
    watchScriptInjection();
  }
}
