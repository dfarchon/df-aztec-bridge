import { describe, expect, it } from "vitest";
import {
  formatDappError,
  pushL1TxDappLog,
  pushL2TxDappLog,
  subscribeDappLog,
  type DappLogInput,
} from "./dapp-log.ts";

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

describe("tx explorer toasts", () => {
  it("attaches an Etherscan link for L1 txs", () => {
    const seen: DappLogInput[] = [];
    const unsub = subscribeDappLog((e) => seen.push(e));
    const hash = "0x" + "11".repeat(32);
    pushL1TxDappLog({
      title: "L1 bridge submitted",
      txHash: hash,
      l1ExplorerUrl: "https://etherscan.io",
    });
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("tx");
    expect(seen[0]?.txLink?.href).toBe(`https://etherscan.io/tx/${hash}`);
    expect(seen[0]?.txLink?.explorerLabel).toBe("Etherscan");
    expect(seen[0]?.detail).toContain("0x11111111…111111");
  });

  it("attaches an Aztec Scan link for L2 txs", () => {
    const seen: DappLogInput[] = [];
    const unsub = subscribeDappLog((e) => seen.push(e));
    const hash = "0x" + "22".repeat(32);
    pushL2TxDappLog({
      title: "L2 claim confirmed",
      txHash: hash,
      networkId: "mainnet",
      aztecExplorerUrl: "https://aztecscan.xyz",
    });
    unsub();
    expect(seen[0]?.txLink?.href).toBe(`https://aztecscan.xyz/tx-effects/${hash}`);
    expect(seen[0]?.txLink?.explorerLabel).toBe("Aztec Scan");
  });
});
