import { useMemo } from "react";
import {
  aztecScanTxEffectUrl,
  l1TxUrl,
  resolveAztecScanOrigin,
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
    const origin = resolveAztecScanOrigin(networkId, aztecExplorerUrl);
    const hash = l2TxHash.startsWith("0x") ? l2TxHash : `0x${l2TxHash}`;
    return `${origin}/tx-effects/${hash}`;
  }, [networkId, aztecExplorerUrl, l2TxHash]);


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
        <a href={l2Href} target="_blank" rel="noopener noreferrer">
          L2 tx on Aztec Scan ↗
        </a>
      ) : null}
    </div>
  );
}
