import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../", import.meta.url);

describe("zod pin", () => {
  it("locks WalletConnect and Aztec on Zod 4.6.7 and parses a string", async () => {
    const lock = readFileSync(new URL("pnpm-lock.yaml", repoRoot), "utf8");
    const versions = [...lock.matchAll(/^  zod@(\d[^:\s]*):/gm)].map((match) => match[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((version) => version === "4.6.7")).toBe(true);
    expect(lock).toContain("zod@<4.6.6: 4.6.7");
    expect(lock).toContain("@walletconnect/universal-provider@2.23.7(typescript@5.7.3)(zod@4.6.7)");

    const zod = await import(new URL("node_modules/.pnpm/zod@4.6.7/node_modules/zod/index.js", repoRoot).href);
    expect(zod.z.string().parse("ok")).toBe("ok");
  });
});
