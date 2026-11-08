import { describe, expect, it } from "vitest";
import { DEV_ALIAS_HOST, DEV_BRANCH_HOST, isDevGateHost, sha256Hex } from "./dev-gate.ts";

describe("isDevGateHost", () => {
  it("matches canonical branch and alias hosts", () => {
    expect(isDevGateHost(DEV_BRANCH_HOST)).toBe(true);
    expect(isDevGateHost(DEV_ALIAS_HOST)).toBe(true);
    expect(isDevGateHost("DEV--Aztec-Dfarchon-Kit.netlify.app")).toBe(true);
  });

  it("rejects production kit host", () => {
    expect(isDevGateHost("aztec-dfarchon-kit.netlify.app")).toBe(false);
    expect(isDevGateHost("localhost")).toBe(false);
  });

  it("gates deploy previews and other branch hosts", () => {
    expect(isDevGateHost("deploy-preview-12--aztec-dfarchon-kit.netlify.app")).toBe(true);
    expect(isDevGateHost("feature--aztec-dfarchon-kit.netlify.app")).toBe(true);
    expect(isDevGateHost("9stx6-dev--aztec-dfarchon-kit.netlify.app")).toBe(true);
  });
});

describe("sha256Hex", () => {
  it("matches a known SHA-256 vector", async () => {
    expect(await sha256Hex("df-dev-gate")).toBe(
      "9d4c29eb3daafcb8c52fe441ff6872f54997e934c4958e08663adf3d98e408f9",
    );
  });
});
