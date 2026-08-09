import { describe, expect, it } from "vitest";
import {
  blendIntervalMs,
  formatCountdown,
  paceFromRemaining,
  paceLabel,
} from "./aztec-block-estimate.ts";
import { formatForDappToast, redactForLog } from "./privacy.ts";

describe("privacy toast vs console", () => {
  it("redactForLog fully hides 32-byte hex", () => {
    const out = redactForLog("peer 203.0.113.9 sent 0x" + "ab".repeat(32));
    expect(out).toContain("[IP_REDACTED]");
    expect(out).toContain("0x[REDACTED]");
  });

  it("formatForDappToast keeps a short tx id", () => {
    const hash = "0x" + "ab".repeat(32);
    const out = formatForDappToast(`L2 claim complete — ${hash}`);
    expect(out).toContain("0xabababab…ababab");
    expect(out).not.toContain("[REDACTED]");
    expect(out).not.toContain(hash);
  });
});

describe("aztec block estimate helpers", () => {
  it("marks on-time / due / behind from remaining ms", () => {
    expect(paceFromRemaining(5_000, 6_000)).toBe("on-time");
    expect(paceFromRemaining(1_000, 6_000)).toBe("due");
    expect(paceFromRemaining(-200, 6_000)).toBe("behind");
    expect(paceLabel("behind")).toMatch(/behind/i);
  });

  it("formats countdown and overdue", () => {
    expect(formatCountdown(4_200)).toBe("5s");
    expect(formatCountdown(-1_100)).toBe("+2s");
  });

  it("blends observed interval toward baseline", () => {
    expect(blendIntervalMs(null, 6_000)).toBe(6_000);
    const blended = blendIntervalMs(8_000, 6_000);
    expect(blended).toBeGreaterThan(6_000);
    expect(blended).toBeLessThan(8_000);
  });
});
