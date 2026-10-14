import { describe, expect, it } from "vitest";
import { isBridgeReadyDfPxeAccount } from "./df-pxe-bridge-guard.ts";
import {
  decideProviderAccountsProbe,
  decideProviderSessionEvent,
  isTrustedConnector,
} from "./wallet-session-guard.ts";
import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import { LEGACY_WALLET_RDNS } from "@df-bridge/browser-sdk";

describe("wallet session + DF PXE bridge guards", () => {
  it("rejects legacy window.ethereum inject as trusted connector", () => {
    const fake = {
      address: "0x" + "11".repeat(20),
      chainId: 1,
      rdns: LEGACY_WALLET_RDNS,
      provider: { request: async () => [] },
    } as unknown as ConnectedWallet;
    expect(isTrustedConnector(fake)).toBe(false);
  });

  it("accepts walletconnect / eip-6963 rdns", () => {
    const wc = {
      address: "0x" + "11".repeat(20),
      chainId: 1,
      rdns: "walletconnect",
      provider: { request: async () => [] },
    } as unknown as ConnectedWallet;
    expect(isTrustedConnector(wc)).toBe(true);
    expect(
      isTrustedConnector({
        ...wc,
        rdns: "io.metamask",
      }),
    ).toBe(true);
  });

  it("requires DF PXE registration bound to ETH address", () => {
    const eth = "0x" + "ab".repeat(20);
    const account = {
      address: "0x" + "11".repeat(32),
      secretKey: "0x" + "22".repeat(32),
      salt: "0x" + "33".repeat(32),
      signingKey: "0x" + "44".repeat(32),
      fromDfClient: true,
      pxeRegistered: true,
      boundEthAddress: eth,
    };
    expect(isBridgeReadyDfPxeAccount(account, eth)).toBe(true);
    expect(isBridgeReadyDfPxeAccount(account, "0x" + "00".repeat(20))).toBe(false);
    expect(
      isBridgeReadyDfPxeAccount({ ...account, pxeRegistered: false }, eth),
    ).toBe(false);
    expect(
      isBridgeReadyDfPxeAccount({ ...account, fromDfClient: false }, eth),
    ).toBe(false);
  });
});

describe("provider session events during wallet confirmation", () => {
  const addr = ("0x" + "ab".repeat(20)) as `0x${string}`;

  it("updates on a real account switch even while a tx is in flight", () => {
    expect(
      decideProviderSessionEvent(
        { kind: "accountsChanged", accounts: [addr] },
        { inFlight: true },
      ),
    ).toEqual({ action: "updateAddress", address: addr });
  });

  it("ignores empty accountsChanged and disconnect while a confirmation is in flight", () => {
    expect(
      decideProviderSessionEvent(
        { kind: "accountsChanged", accounts: [] },
        { inFlight: true },
      ),
    ).toEqual({ action: "ignore" });
    expect(
      decideProviderSessionEvent({ kind: "disconnect" }, { inFlight: true }),
    ).toEqual({ action: "ignore" });
  });

  it("probes eth_accounts on idle empty accounts or disconnect", () => {
    expect(
      decideProviderSessionEvent(
        { kind: "accountsChanged", accounts: [] },
        { inFlight: false },
      ),
    ).toEqual({ action: "probeAccounts" });
    expect(
      decideProviderSessionEvent({ kind: "disconnect" }, { inFlight: false }),
    ).toEqual({ action: "probeAccounts" });
  });

  it("keeps the session if the probe RPC fails or still has an account", () => {
    expect(decideProviderAccountsProbe({ error: new Error("popup") })).toEqual({
      action: "ignore",
    });
    expect(decideProviderAccountsProbe({ accounts: [addr] })).toEqual({
      action: "updateAddress",
      address: addr,
    });
  });

  it("clears the session only after an idle probe finds no accounts", () => {
    expect(decideProviderAccountsProbe({ accounts: [] })).toEqual({
      action: "clear",
    });
  });
});
