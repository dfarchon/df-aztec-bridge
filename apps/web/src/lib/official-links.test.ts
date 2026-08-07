import { describe, expect, it } from "vitest";
import {
  AZTECSCAN_MAINNET,
  AZTECSCAN_TESTNET,
  OFFICIAL_DOCS_NETWORKS,
  aztecScanBlockUrl,
  aztecScanTxEffectUrl,
  isOfficialHttpsUrl,
  l1TxUrl,
} from "./official-links.ts";
import { redactForLog } from "./privacy.ts";

describe("official-links", () => {
  it("points mainnet scan at aztecscan.xyz", () => {
    expect(AZTECSCAN_MAINNET).toBe("https://aztecscan.xyz");
    expect(aztecScanBlockUrl("mainnet", 42)).toBe("https://aztecscan.xyz/blocks/42");
    expect(aztecScanTxEffectUrl("mainnet", "0xabc")).toBe(
      "https://aztecscan.xyz/tx-effects/0xabc",
    );
  });

  it("points testnet scan at testnet.aztecscan.xyz", () => {
    expect(AZTECSCAN_TESTNET).toBe("https://testnet.aztecscan.xyz");
    expect(aztecScanBlockUrl("testnet", 7)).toBe("https://testnet.aztecscan.xyz/blocks/7");
  });

  it("allowlists official HTTPS hosts only", () => {
    expect(isOfficialHttpsUrl("https://docs.aztec.network/networks")).toBe(true);
    expect(isOfficialHttpsUrl("https://aztecscan.xyz/")).toBe(true);
    expect(isOfficialHttpsUrl("https://aztec-mainnet.drpc.org")).toBe(true);
    expect(isOfficialHttpsUrl("https://lb.drpc.live/aztec-mainnet/x")).toBe(true);
    expect(isOfficialHttpsUrl("http://aztecscan.xyz/")).toBe(false);
    expect(isOfficialHttpsUrl("https://evil.example/")).toBe(false);
  });

  it("builds HTTPS L1 explorer tx links", () => {
    expect(l1TxUrl("https://etherscan.io", "0xdead")).toBe("https://etherscan.io/tx/0xdead");
    expect(l1TxUrl("http://etherscan.io", "0xdead")).toBeNull();
    expect(OFFICIAL_DOCS_NETWORKS).toContain("docs.aztec.network");
  });
});

describe("privacy redactForLog", () => {
  it("redacts IPs and 32-byte hex", () => {
    const out = redactForLog("peer 203.0.113.9 sent 0x" + "ab".repeat(32));
    expect(out).toContain("[IP_REDACTED]");
    expect(out).toContain("0x[REDACTED]");
    expect(out).not.toContain("203.0.113");
  });
});
