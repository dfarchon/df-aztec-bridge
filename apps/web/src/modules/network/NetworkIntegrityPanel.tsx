import { useCallback, useEffect, useMemo, useState } from "react";
import type { WebNetworkConfig } from "../../config/networks.ts";
import {
  OFFICIAL_DOCS_NETWORKS,
  OFFICIAL_DOCS_FEE_JUICE,
  resolveAztecScanOrigin,
} from "../../lib/official-links.ts";
import {
  verifyNetworkAgainstOfficial,
  type NetworkVerifyResult,
} from "../../lib/network-verify.ts";

function integrityFacts(result: NetworkVerifyResult): Array<{
  label: string;
  value: string;
  bad: boolean;
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

  return [
    { label: "App & node", value: versionValue, bad: versionBad },
    { label: "Latest block", value: blockValue, bad: blockBad },
    { label: "Fee Juice", value: feeValue, bad: result.addressMatch === false },
    {
      label: "Connection",
      value: result.officialRpcHost ? "Official host" : "Custom host",
      bad: false,
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

  const facts = useMemo(() => (result ? integrityFacts(result) : []), [result]);

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
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className={fact.bad ? "is-bad" : undefined}>{fact.value}</dd>
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
