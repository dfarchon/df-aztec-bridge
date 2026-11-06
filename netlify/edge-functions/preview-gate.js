/**
 * Blocks branch deploys and deploy previews before any app asset is sent.
 * Production host is passed through. Password lives in DEV_GATE_PASSWORD (not VITE_*).
 */

import {
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_TTL_MS,
  isPreviewGateHost,
  passwordMatches,
  readCookie,
  signPreviewCookie,
  verifyPreviewCookie,
} from "./preview-gate-logic.js";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function page(message, showForm) {
  const note = message
    ? `<p>${message}</p>`
    : "<p>This preview is locked. The password stays on the server.</p>";
  const form = showForm
    ? `<form method="post" action="/__preview-gate">
         <label>Preview password <input name="password" type="password" autocomplete="current-password" required minlength="12" /></label>
         <button type="submit">Continue</button>
       </form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview locked</title></head><body><h1>Preview locked</h1>${note}${form}</body></html>`;
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
    let given = "";
    try {
      const form = await request.formData();
      given = String(form.get("password") ?? "");
    } catch {
      given = "";
    }
    if (!(await passwordMatches(given, password))) {
      return html(401, "Invalid password.", true);
    }
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
