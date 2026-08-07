import { describe, expect, it } from "vitest";
import { formatDappError } from "./dapp-log.ts";

describe("formatDappError", () => {
  it("maps CSP refusals to a readable PXE message", () => {
    const out = formatDappError(
      new TypeError(
        "Failed to fetch. Refused to connect because it violates the document's Content Security Policy.",
      ),
    );
    expect(out.title).toMatch(/Content Security Policy/i);
    expect(out.detail).toMatch(/data:/i);
  });

  it("maps generic Failed to fetch", () => {
    const out = formatDappError(new TypeError("Failed to fetch"));
    expect(out.title).toMatch(/fetch failed/i);
  });
});
