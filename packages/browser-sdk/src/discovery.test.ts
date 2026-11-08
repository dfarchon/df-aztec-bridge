import { afterEach, describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("wallet discovery provider isolation", () => {
  it("replaces a legacy entry when the same provider announces via EIP-6963", async () => {
    const provider = { request: vi.fn() } as unknown as EIP1193Provider;
    const browser = Object.assign(new EventTarget(), { ethereum: provider });
    vi.stubGlobal("window", browser);
    const { getWalletsSnapshot, LEGACY_WALLET_RDNS } = await import("./discovery.ts");
    const legacy = getWalletsSnapshot();
    expect(legacy).toHaveLength(1);
    expect(legacy[0].info.rdns).toBe(LEGACY_WALLET_RDNS);
    expect(legacy[0].provider).not.toBe(provider);

    const info = { uuid: "wallet-1", rdns: "test.wallet", name: "Test", icon: "" };
    browser.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info, provider },
    }));
    const announced = getWalletsSnapshot();
    expect(announced).toHaveLength(1);
    expect(announced[0].info).toEqual(info);
    expect(announced[0].provider).toBe(legacy[0].provider);
  });

  it("isolates providers announced synchronously during discovery", async () => {
    const provider = { request: vi.fn() } as unknown as EIP1193Provider;
    const browser = new EventTarget();
    const info = { uuid: "wallet-1", rdns: "test.wallet", name: "Test", icon: "" };
    browser.addEventListener("eip6963:requestProvider", () => {
      browser.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: { info, provider },
      }));
    });
    vi.stubGlobal("window", browser);
    const { getWalletsSnapshot } = await import("./discovery.ts");
    const [discovered] = getWalletsSnapshot();
    expect(discovered.info).toEqual(info);
    expect(discovered.provider).not.toBe(provider);
    expect(Object.keys(discovered.provider)).toEqual(["request"]);
  });
});
