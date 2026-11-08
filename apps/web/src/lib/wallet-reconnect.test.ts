import { describe, expect, it, vi } from "vitest";
import type { EIP6963ProviderDetail } from "@df-bridge/browser-sdk";
import { DISCONNECTED_CONNECTOR, findAuthorizedWallet } from "./wallet-reconnect.ts";

function wallet(rdns: string, accounts: string[], chain = "0x1") {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return accounts;
    if (method === "eth_chainId") return chain;
    throw new Error(`Unexpected request: ${method}`);
  });
  return { info: { rdns, name: rdns, uuid: rdns, icon: "" }, provider: { request } } as unknown as EIP6963ProviderDetail;
}
const address = "0x1111111111111111111111111111111111111111";

describe("silent wallet restoration", () => {
  it("restores the remembered authorized wallet without requesting permission", async () => {
    const one = wallet("one.wallet", [address]);
    const two = wallet("two.wallet", [address]);
    const result = await findAuthorizedWallet([one, two], "one.wallet", 1);
    expect(result?.address).toBe(address);
    expect(result?.rdns).toBe("one.wallet");
    expect(one.provider.request).toHaveBeenCalledTimes(2);
    expect(two.provider.request).not.toHaveBeenCalled();
  });

  it("restores only an unambiguous authorized wallet for existing users", async () => {
    const one = wallet("one.wallet", [address]);
    const two = wallet("two.wallet", []);
    expect((await findAuthorizedWallet([one, two], null, 1))?.rdns).toBe("one.wallet");
    expect(await findAuthorizedWallet([one, wallet("other.wallet", [address])], null, 1)).toBeNull();
  });

  it("respects disconnect, missing authorization, wrong chains and unknown connector", async () => {
    const one = wallet("one.wallet", [address]);
    expect(await findAuthorizedWallet([one], DISCONNECTED_CONNECTOR, 1)).toBeNull();
    expect(await findAuthorizedWallet([one], "walletconnect", 1)).toBeNull();
    expect(await findAuthorizedWallet([one], "other.wallet", 1)).toBeNull();
    expect(await findAuthorizedWallet([one], "one.wallet", 10)).toBeNull();
    expect(await findAuthorizedWallet([wallet("one.wallet", [])], "one.wallet", 1)).toBeNull();
  });
});
