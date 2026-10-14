import { useCallback, useEffect, useState } from "react";
import { TxAnalysisLinks } from "../../components/ui/TxAnalysisLinks.tsx";
import { shortHash } from "../../lib/claim-recovery.ts";
import {
  formatHistoryAmount,
  groupHistoryByDay,
  listHistory,
  type HistoryEntry,
} from "../../lib/operation-history.ts";
import { isVaultUnlocked } from "../../lib/vault.ts";
import { useNetwork } from "../../providers/NetworkProvider.tsx";
import { useVault } from "../../providers/VaultProvider.tsx";

export function HistoryPage() {
  const { networkMeta } = useNetwork();
  const { unlocked, requestUnlock } = useVault();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isVaultUnlocked()) {
      setEntries([]);
      return;
    }
    try {
      setEntries(await listHistory());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, unlocked]);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const groups = groupHistoryByDay(entries);

  return (
    <div className="bridge-layout recover-layout history-layout" aria-label="History">
      <section className="bridge-step">
        {selected ? (
          <HistoryDetail
            entry={selected}
            l1ExplorerUrl={networkMeta?.l1ExplorerUrl}
            aztecExplorerUrl={networkMeta?.aztecExplorerUrl}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <>
            <p className="wallet-manager-pane-title">History</p>
            {!unlocked ? (
              <>
                <p className="hint">
                  Unlock the vault to see deposits, claims, and account changes from this browser.
                </p>
                <button type="button" onClick={requestUnlock}>
                  Unlock vault
                </button>
              </>
            ) : entries.length === 0 ? (
              <p className="hint">
                No operations yet. A finished bridge or claim will show up here.
              </p>
            ) : (
              <div className="history-groups">
                {groups.map((group) => (
                  <div key={group.day} className="history-day">
                    <p className="label">{group.day}</p>
                    <ul className="recovery-session-list">
                      {group.items.map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="recovery-session-item"
                            onClick={() => setSelectedId(entry.id)}
                          >
                            <span className="recovery-session-amount">{entry.title}</span>
                            <span className="hint">
                              {formatHistoryTime(entry.at)}
                              {entry.recipient ? ` · ${shortHash(entry.recipient)}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {error ? <p className="error">{error}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

function HistoryDetail({
  entry,
  l1ExplorerUrl,
  aztecExplorerUrl,
  onBack,
}: {
  entry: HistoryEntry;
  l1ExplorerUrl?: string;
  aztecExplorerUrl?: string;
  onBack: () => void;
}) {
  const amount = formatHistoryAmount(entry.amount);
  return (
    <>
      <p className="wallet-manager-pane-title">{entry.title}</p>
      {entry.detail ? <p className="hint">{entry.detail}</p> : null}
      {amount ? <p className="hint">{amount} FJ</p> : null}
      {entry.recipient ? <p className="hint">{shortHash(entry.recipient)}</p> : null}
      <p className="hint">{formatHistoryTime(entry.at)}</p>
      <TxAnalysisLinks
        networkId={entry.networkId}
        l1ExplorerUrl={l1ExplorerUrl}
        aztecExplorerUrl={aztecExplorerUrl}
        l1TxHash={entry.l1TxHash}
        l2TxHash={entry.l2TxHash}
      />
      <button type="button" className="ghost" onClick={onBack}>
        Back
      </button>
    </>
  );
}

function formatHistoryTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
