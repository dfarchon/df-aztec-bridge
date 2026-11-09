/**
 * Blocks branch deploys and deploy previews before any app asset is sent.
 * Production host is passed through. Password lives in DEV_GATE_PASSWORD (not VITE_*).
 */

import {
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_TTL_MS,
  clientIpFromHeaders,
  createAttemptLimiter,
  escapeHtml,
  isPreviewGateHost,
  passwordMatches,
  readCookie,
  signPreviewCookie,
  verifyPreviewCookie,
} from "../edge-shared/preview-gate-logic.js";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const attemptLimiter = createAttemptLimiter();

/** Inline only. The gate CSP is style-src 'unsafe-inline' and blocks app assets. */
const GATE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    min-height: 100%;
    background: #000;
    color: #ede4e8;
    font-family: system-ui, sans-serif;
    font-size: 1.0625rem;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }
  .void {
    pointer-events: none;
    position: fixed;
    inset: 0;
    background:
      radial-gradient(90% 55% at 50% -8%, rgba(255, 77, 172, 0.05), transparent 50%),
      radial-gradient(70% 45% at 85% 100%, rgba(255, 255, 255, 0.025), transparent 48%);
  }
  main {
    position: relative;
    z-index: 1;
    width: min(100%, 28rem);
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 2rem 1.25rem 3rem;
  }
  .kicker {
    margin: 0 0 0.4rem;
    color: #9a8a92;
    font-family: ui-monospace, "Cascadia Code", "Courier New", monospace;
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0 0 0.55rem;
    color: #fff;
    font-size: clamp(1.375rem, 4vw, 2rem);
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: 0;
  }
  .prompt { color: #ede4e8; }
  .gate-msg {
    margin: 0 0 1.15rem;
    max-width: 32rem;
    color: #9a8a92;
    font-size: 0.95rem;
    line-height: 1.45;
  }
  .gate-msg-error { color: #e78398; }
  label {
    display: block;
    margin: 0 0 0.28rem;
    color: #9a8a92;
    font-size: 0.76rem;
  }
  input {
    display: block;
    width: 100%;
    min-height: 44px;
    margin: 0;
    padding: 0.42rem 0.55rem;
    color: #ede4e8;
    background: #000;
    border: 1px solid #2b1f26;
    border-radius: 0;
    font: inherit;
  }
  input:focus { outline: 0; border-color: #2b1f26; }
  input[aria-invalid="true"] { box-shadow: inset 2px 0 0 #e78398; }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    margin-top: 0.85rem;
    margin-left: auto;
    margin-right: auto;
    min-height: 44px;
    padding: 0.75em 1.5em;
    color: #ede4e8;
    background: #000;
    border: 1px solid #2b1f26;
    border-radius: 0;
    font: inherit;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
  }
  button:hover { background: #ffd0da; color: #000; border-color: #ffd0da; }
  button:focus-visible { outline: 0; }
  ::selection { background: rgba(255, 183, 197, 0.12); color: #ede4e8; }
`;

function page(message, showForm) {
  const note = message
    ? `<p class="gate-msg gate-msg-error" role="alert">${escapeHtml(message)}</p>`
    : `<p class="gate-msg">This preview is locked. The password stays on the server.</p>`;
  const invalid = message ? ` aria-invalid="true"` : "";
  const form = showForm
    ? `<form method="post" action="/__preview-gate">
         <label for="preview-password">Preview password</label>
         <input id="preview-password" name="password" type="password" autocomplete="current-password" required minlength="12"${invalid} />
         <button type="submit">Continue</button>
       </form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview locked</title><style>${GATE_CSS}</style></head><body><div class="void" aria-hidden="true"></div><main><p class="kicker">Deploy preview</p><h1><span class="prompt">&gt; </span>DF Aztec Bridge</h1>${note}${form}</main></body></html>`;
}

function html(status, message, showForm) {
  return new Response(page(message, showForm), { status, headers: HEADERS });
}

export default async function previewGate(request, context) {
  const url = new URL(request.url);
  if (!isPreviewGateHost(url.hostname)) return context.next();

  const password = (globalThis.Netlify?.env?.get("DEV_GATE_PASSWORD") ?? "").trim();
  if (password.length < 12) {
    return html(
      503,
      "Set DEV_GATE_PASSWORD (12+ characters) in the Netlify UI for preview deploys. Do not put it in a VITE_ variable.",
      false,
    );
  }

  if (request.method === "POST" && url.pathname === "/__preview-gate") {
    const clientKey = clientIpFromHeaders(request.headers);
    if (attemptLimiter.isLimited(clientKey)) {
      return html(429, "Too many attempts. Wait a minute and try again.", true);
    }
    let given = "";
    try {
      const form = await request.formData();
      given = String(form.get("password") ?? "");
    } catch {
      given = "";
    }
    if (!(await passwordMatches(given, password))) {
      attemptLimiter.recordFailure(clientKey);
      if (attemptLimiter.isLimited(clientKey)) {
        return html(429, "Too many attempts. Wait a minute and try again.", true);
      }
      return html(401, "Invalid password.", true);
    }
    attemptLimiter.clear(clientKey);
    const exp = Date.now() + PREVIEW_COOKIE_TTL_MS;
    const token = await signPreviewCookie(password, url.hostname, exp);
    const headers = new Headers(HEADERS);
    headers.set("location", "/");
    headers.append(
      "set-cookie",
      `${PREVIEW_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(PREVIEW_COOKIE_TTL_MS / 1000)}`,
    );
    return new Response(null, { status: 303, headers });
  }

  const token = readCookie(request.headers.get("cookie"), PREVIEW_COOKIE);
  if (await verifyPreviewCookie(password, url.hostname, token, Date.now())) {
    return context.next();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return html(401, "Preview locked.", false);
  }
  return html(401, "", true);
}

export const config = { path: "/*" };
