import { useCallback, useEffect, useMemo, useState } from "react";
import type { WebNetworkConfig } from "../../config/networks.ts";
import {
  OFFICIAL_DOCS_NETWORKS,
  OFFICIAL_DOCS_FEE_JUICE,
  l1AddressUrl,
  resolveAztecScanOrigin,
} from "../../lib/official-links.ts";
import {
  verifyNetworkAgainstOfficial,
  type NetworkVerifyResult,
} from "../../lib/network-verify.ts";

/** Hostname only. A keyed RPC path must not appear in the hover. */
function rpcHost(url: string): string | undefined {
  try {
    const host = new URL(url).host;
    return host || undefined;
  } catch {
    return undefined;
  }
}

type IntegrityTip = {
  text?: string;
  links?: Array<{ text: string; href?: string }>;
};

/** Bridge contract in use. Node disagreement adds a second address. No label. */
function feeJuiceContractTip(
  result: NetworkVerifyResult,
  network: WebNetworkConfig,
): IntegrityTip | undefined {
  const app = network.l1Addresses.feeJuicePortal?.trim();
  const node = result.node?.feeJuicePortal?.trim();
  const addresses = [app, node].filter((address): address is string => {
    if (!address) return false;
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  });
  const unique = addresses.filter(
    (address, index) =>
      addresses.findIndex((other) => other.toLowerCase() === address.toLowerCase()) === index,
  );
  if (!unique.length) return undefined;
  return {
    links: unique.map((address) => ({
      text: address,
      href: l1AddressUrl(network.l1ExplorerUrl, address) ?? undefined,
    })),
  };
}

function integrityFacts(
  result: NetworkVerifyResult,
  network: WebNetworkConfig,
): Array<{
  label: string;
  value: string;
  bad: boolean;
  tip?: IntegrityTip;
}> {
  const versionBad = result.versionMatch === false || !result.node;
  const versionValue =
    result.node && result.versionMatch === false
      ? `App ${result.clientVersion}, node ${result.node.nodeVersion}`
      : result.node
        ? result.clientVersion
        : "Unavailable";

  const blockBad =
    result.primaryBlock === null || (result.blockDelta !== null && result.blockDelta > 32);
  let blockValue = result.primaryBlock === null ? "Unavailable" : result.primaryBlock.toLocaleString();
  if (
    result.primaryBlock !== null &&
    result.crosscheckBlock !== null &&
    result.crosscheckBlock !== result.primaryBlock &&
    result.blockDelta !== null
  ) {
    blockValue = `${blockValue}, off by ${result.blockDelta}`;
  }

  const feeValue =
    result.addressMatch === null ? "Not checked" : result.addressMatch ? "Official" : "Don't match";
  const host = rpcHost(network.aztecNodeUrl);

  return [
    { label: "App & node", value: versionValue, bad: versionBad },
    { label: "Latest block", value: blockValue, bad: blockBad },
    {
      label: "Fee Juice",
      value: feeValue,
      bad: result.addressMatch === false,
      tip: feeJuiceContractTip(result, network),
    },
    {
      label: "Connection",
      value: result.officialRpcHost ? "Official host" : "Custom host",
      bad: !result.officialRpcHost,
      tip: host ? { text: host } : undefined,
    },
  ];
}

export function NetworkIntegrityPanel(props: {
  network: WebNetworkConfig | null;
}) {
  const { network } = props;
  const [result, setResult] = useState<NetworkVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!network || network.id === "local") {
      setResult(null);
      return;
    }
    setBusy(true);
    try {
      setResult(await verifyNetworkAgainstOfficial(network));
    } finally {
      setBusy(false);
    }
  }, [network]);

  useEffect(() => {
    void run();
    const id = window.setInterval(() => void run(), 60_000);
    return () => window.clearInterval(id);
  }, [run]);

  const facts = useMemo(
    () => (result && network ? integrityFacts(result, network) : []),
    [result, network],
  );

  if (!network || network.id === "local") return null;

  const scanOrigin = resolveAztecScanOrigin(network.id, network.aztecExplorerUrl);

  const ok =
    result &&
    result.errors.length === 0 &&
    result.versionMatch &&
    result.addressMatch !== false &&
    (result.blockDelta === null || result.blockDelta <= 32);

  return (
    <section className="integrity-panel" aria-live="polite">
      <div className="integrity-header">
        <p className="wallet-manager-pane-title">Network integrity</p>
        <button
          type="button"
          className="ghost integrity-refresh"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? "Checking…" : "Re-check"}
        </button>
      </div>
      {!result ? (
        <p className="hint">Checking this network…</p>
      ) : (
        <>
          <p className={ok ? "integrity-summary" : "integrity-summary is-bad"}>
            {ok ? "Safe to bridge." : "Don't bridge yet."}
          </p>
          <dl className="integrity-facts" role="status">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className={fact.tip ? "has-tip" : undefined}
                tabIndex={fact.tip ? 0 : undefined}
              >
                <dt>{fact.label}</dt>
                <dd className={fact.bad ? "is-bad" : undefined}>
                  {fact.value}
                  {fact.tip ? (
                    <span className="integrity-tip" role="tooltip">
                      {fact.tip.text}
                      {fact.tip.links?.map((link) =>
                        link.href ? (
                          <a
                            key={link.href}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.text}
                          </a>
                        ) : (
                          <span key={link.text}>{link.text}</span>
                        ),
                      )}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <div className="integrity-links">
            <a href={scanOrigin} target="_blank" rel="noopener noreferrer">
              Aztec Scan ↗
            </a>
            {result.aztecScanLatestBlockUrl ? (
              <a
                href={result.aztecScanLatestBlockUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Current block on Aztec Scan"
              >
                This block ↗
              </a>
            ) : null}
            <a href={OFFICIAL_DOCS_NETWORKS} target="_blank" rel="noopener noreferrer">
              Networks ↗
            </a>
            <a
              href={OFFICIAL_DOCS_FEE_JUICE}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Fee Juice docs"
            >
              Fee Juice ↗
            </a>
          </div>
          {result.errors.length ? (
            <ul className="error integrity-errors">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
