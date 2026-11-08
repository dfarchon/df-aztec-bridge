import { describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import { toUiSafeProvider } from "./provider.ts";
import { connectWithProvider } from "./wallet.ts";

function extensionProvider() {
  const readInternal = vi.fn(() => {
    throw new TypeError("s[c].bind is not a function");
  });
  const provider = {
    request: vi.fn(function (this: unknown, args: { method: string }) {
      expect(this).toBe(provider);
      return Promise.resolve(args.method === "eth_requestAccounts"
        ? ["0x1111111111111111111111111111111111111111"]
        : "0x1");
    }),
    on: vi.fn(function (this: unknown) { expect(this).toBe(provider); }),
    removeListener: vi.fn(function (this: unknown) { expect(this).toBe(provider); }),
  };
  Object.defineProperty(provider, "internal", { enumerable: true, get: readInternal });
  return { provider: provider as unknown as EIP1193Provider, readInternal };
}

// Mirrors the recursive property inspection performed by React's dev tracing.
function inspectProperties(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 3) return;
  for (const key of Object.keys(value)) {
    inspectProperties((value as Record<string, unknown>)[key], depth + 1);
  }
}

describe("UI-safe wallet providers", () => {
  it("keeps throwing extension internals out of props inspection", () => {
    const { provider, readInternal } = extensionProvider();
    expect(() => inspectProperties({ provider })).toThrow(/bind/);
    readInternal.mockClear();
    const safe = toUiSafeProvider(provider);
    expect(() => inspectProperties({ provider: safe })).not.toThrow();
    expect(readInternal).not.toHaveBeenCalled();
  });

  it("preserves provider identity across discovery and connection", () => {
    const { provider } = extensionProvider();
    const safe = toUiSafeProvider(provider);
    expect(toUiSafeProvider(provider)).toBe(safe);
    expect(toUiSafeProvider(safe)).toBe(safe);
  });

  it("forwards detached requests and event subscriptions with the correct receiver", async () => {
    const { provider } = extensionProvider();
    const { request, on, removeListener } = toUiSafeProvider(provider);
    await expect(request({ method: "eth_chainId" })).resolves.toBe("0x1");
    const listener = vi.fn();
    on("accountsChanged", listener);
    removeListener("accountsChanged", listener);
    expect(provider.on).toHaveBeenCalledWith("accountsChanged", listener);
    expect(provider.removeListener).toHaveBeenCalledWith("accountsChanged", listener);
  });

  it("does not invent event methods for request-only providers", () => {
    const provider = { request: vi.fn() } as unknown as EIP1193Provider;
    expect(toUiSafeProvider(provider).on).toBeUndefined();
    expect(toUiSafeProvider(provider).removeListener).toBeUndefined();
  });

  it("returns a connected wallet that can be inspected safely", async () => {
    const { provider, readInternal } = extensionProvider();
    const wallet = await connectWithProvider(provider, { rdns: "test.wallet" });
    expect(wallet.address).toBe("0x1111111111111111111111111111111111111111");
    expect(wallet.chainId).toBe(1);
    expect(wallet.provider).toBe(toUiSafeProvider(provider));
    expect(() => inspectProperties(wallet)).not.toThrow();
    expect(readInternal).not.toHaveBeenCalled();
  });
});
