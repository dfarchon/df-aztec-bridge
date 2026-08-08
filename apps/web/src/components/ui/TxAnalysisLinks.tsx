import { useMemo } from "react";
import {
  aztecExplorerLinkLabel,
  aztecScanTxEffectUrl,
  isLocalExplorerOrigin,
  l1TxUrl,
} from "../../lib/official-links.ts";

export function TxAnalysisLinks(props: {
  networkId: string;
  l1ExplorerUrl?: string;
  aztecExplorerUrl?: string;
  l1TxHash?: string | null;
  l2TxHash?: string | null;
}) {
  const { networkId, l1ExplorerUrl, aztecExplorerUrl, l1TxHash, l2TxHash } = props;
  const l1Href = useMemo(
    () => (l1TxHash ? l1TxUrl(l1ExplorerUrl, l1TxHash) : null),
    [l1ExplorerUrl, l1TxHash],
  );
  const l2Href = useMemo(() => {
    if (!l2TxHash) return null;
    return aztecScanTxEffectUrl(networkId, l2TxHash, aztecExplorerUrl);
  }, [networkId, aztecExplorerUrl, l2TxHash]);

  const l2Label = aztecExplorerLinkLabel(aztecExplorerUrl);
  const l2SameOrigin =
    !!aztecExplorerUrl &&
    isLocalExplorerOrigin(aztecExplorerUrl) &&
    typeof window !== "undefined" &&
    window.location.origin === new URL(aztecExplorerUrl).origin;

  if (!l1Href && !l2Href) return null;

  return (
    <div className="tx-analysis-links">
      <p className="label">analyze</p>
      {l1Href ? (
        <a href={l1Href} target="_blank" rel="noopener noreferrer">
          L1 tx on explorer ↗
        </a>
      ) : null}
      {l2Href ? (
        <a
          href={l2Href}
          target={l2SameOrigin ? undefined : "_blank"}
          rel={l2SameOrigin ? undefined : "noopener noreferrer"}
        >
          L2 tx on {l2Label} ↗
        </a>
      ) : null}
    </div>
  );
}
