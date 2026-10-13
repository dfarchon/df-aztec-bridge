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

function integrityStatusParts(result: NetworkVerifyResult): string[] {
  return [
    `client ${result.clientVersion}${result.node ? ` · node ${result.node.nodeVersion}` : ""}${
      result.versionMatch === false ? " · VERSION DRIFT" : ""
    }`,
    `tip ${result.primaryBlock ?? "—"}${
      result.crosscheckBlock !== null && result.crosscheckBlock !== result.primaryBlock
        ? ` · cross-check ${result.crosscheckBlock} (Δ${result.blockDelta})`
        : ""
    }`,
    `Fee Juice / portal ${
      result.addressMatch === null
        ? "unchecked"
        : result.addressMatch
          ? "match official"
          : "MISMATCH"
    }`,
    `RPC host ${result.officialRpcHost ? "allowlisted" : "custom — verify HTTPS host"}`,
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

  const statusText = useMemo(
    () => (result ? integrityStatusParts(result).join(" · ") : ""),
    [result],
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
        <p className="label">network integrity</p>
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
        <p className="hint">Verifying client vs node tip and official addresses…</p>
      ) : (
        <>
          <p className={ok ? "hint storage-status-ok" : "error"}>
            {ok
              ? "Client, node version, Fee Juice addresses, and block tip look consistent."
              : "Mismatch or tip skew detected — do not bridge until resolved."}
          </p>
          <p className="integrity-status hint mono" role="status">
            {statusText}
          </p>
          <div className="integrity-links">
            <a href={scanOrigin} target="_blank" rel="noopener noreferrer">
              Aztec Scan ↗
            </a>
            {result.aztecScanLatestBlockUrl ? (
              <a href={result.aztecScanLatestBlockUrl} target="_blank" rel="noopener noreferrer">
                Current block on Scan ↗
              </a>
            ) : null}
            <a href={OFFICIAL_DOCS_NETWORKS} target="_blank" rel="noopener noreferrer">
              Official networks ↗
            </a>
            <a href={OFFICIAL_DOCS_FEE_JUICE} target="_blank" rel="noopener noreferrer">
              Fee Juice docs ↗
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
