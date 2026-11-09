import { describe, expect, it } from "vitest";
import {
  createAttemptLimiter,
  escapeHtml,
  isPreviewGateHost,
  passwordMatches,
  readCookie,
  signPreviewCookie,
  verifyPreviewCookie,
} from "../../../../netlify/edge-shared/preview-gate-logic.js";

const HOST = "deploy-preview-12--aztec-dfarchon-kit-v6.netlify.app";
const PASS = "preview-password";

describe("preview edge gate", () => {
  it("gates preview hosts and leaves production and localhost open", () => {
    expect(isPreviewGateHost("aztec-dfarchon-kit-v6.netlify.app")).toBe(false);
    expect(isPreviewGateHost("localhost")).toBe(false);
    expect(isPreviewGateHost("127.0.0.1")).toBe(false);
    expect(isPreviewGateHost(HOST)).toBe(true);
    expect(isPreviewGateHost("dev--aztec-dfarchon-kit-v6.netlify.app")).toBe(true);
    expect(isPreviewGateHost("dev.aztec-dfarchon-kit-v6.netlify.app")).toBe(true);
    expect(isPreviewGateHost("evil.netlify.app")).toBe(false);
  });

  it("accepts the password and rejects a different one", async () => {
    expect(await passwordMatches(PASS, PASS)).toBe(true);
    expect(await passwordMatches("other-password", PASS)).toBe(false);
  });

  it("signs a host-bound cookie and rejects expiry, host, and tamper", async () => {
    const exp = 1_700_000_000_000;
    const token = await signPreviewCookie(PASS, HOST, exp);
    expect(await verifyPreviewCookie(PASS, HOST, token, exp - 1)).toBe(true);
    expect(await verifyPreviewCookie(PASS, HOST, token, exp)).toBe(false);
    expect(await verifyPreviewCookie(PASS, "other.example", token, exp - 1)).toBe(false);
    expect(await verifyPreviewCookie("wrong-password", HOST, token, exp - 1)).toBe(false);
    expect(await verifyPreviewCookie(PASS, HOST, `${exp}.00`, exp - 1)).toBe(false);
    expect(readCookie(`a=1; df_preview_gate=${encodeURIComponent(token)}`, "df_preview_gate")).toBe(token);
  });

  it("escapes HTML in gate messages", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("rate-limits failed attempts within the window", () => {
    const limiter = createAttemptLimiter({ maxAttempts: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(limiter.isLimited("1.2.3.4", t0)).toBe(false);
    expect(limiter.recordFailure("1.2.3.4", t0)).toBe(false);
    expect(limiter.recordFailure("1.2.3.4", t0 + 1)).toBe(false);
    expect(limiter.recordFailure("1.2.3.4", t0 + 2)).toBe(true);
    expect(limiter.isLimited("1.2.3.4", t0 + 3)).toBe(true);
    limiter.clear("1.2.3.4");
    expect(limiter.isLimited("1.2.3.4", t0 + 4)).toBe(false);
  });
});
