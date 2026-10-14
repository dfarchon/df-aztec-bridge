import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultTtlMs,
  subscribeDappLog,
  type DappLogEntry,
  type DappLogInput,
  type DappLogKind,
  type DappLogTxLink,
} from "../../lib/dapp-log.ts";
import { isLocalExplorerOrigin } from "../../lib/official-links.ts";
import { formatForDappToast } from "../../lib/privacy.ts";

const MAX_VISIBLE = 8;

function kindLabel(kind: DappLogKind): string {
  switch (kind) {
    case "tx":
      return "tx";
    case "error":
      return "error";
    case "announce":
      return "announce";
    default:
      return "info";
  }
}

function shortTxDisplay(hash: string): string {
  return formatForDappToast(hash);
}

function TxExplorerLink(props: { link: DappLogTxLink }) {
  const { link } = props;
  const display = shortTxDisplay(link.hash);
  if (!link.href) {
    return (
      <p className="dapp-log-tx-link dapp-log-tx-link-plain mono" title={link.hash}>
        {display}
      </p>
    );
  }
  const sameOrigin =
    isLocalExplorerOrigin(link.href) &&
    typeof window !== "undefined" &&
    (() => {
      try {
        return window.location.origin === new URL(link.href!).origin;
      } catch {
        return false;
      }
    })();
  return (
    <a
      className="dapp-log-tx-link mono"
      href={link.href}
      target={sameOrigin ? undefined : "_blank"}
      rel={sameOrigin ? undefined : "noopener noreferrer"}
      title={link.hash}
    >
      <span className="dapp-log-tx-hash">{display}</span>
      <span className="dapp-log-tx-explorer">{link.explorerLabel} ↗</span>
    </a>
  );
}

function LogCard(props: {
  entry: DappLogEntry;
  onDismiss: (id: string) => void;
}) {
  const { entry, onDismiss } = props;
  const showDetail = entry.detail && !entry.txLink;
  return (
    <article className={`dapp-log-card dapp-log-${entry.kind}`} role="status">
      <header className="dapp-log-card-head">
        <span className="dapp-log-kind">{kindLabel(entry.kind)}</span>
        <time className="dapp-log-time" dateTime={new Date(entry.at).toISOString()}>
          {new Date(entry.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </time>
        <button
          type="button"
          className="dapp-log-dismiss"
          aria-label="Dismiss log"
          onClick={() => onDismiss(entry.id)}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              fill="currentColor"
              d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
            />
          </svg>
        </button>
      </header>
      <p className="dapp-log-title">{entry.title}</p>
      {entry.txLink ? <TxExplorerLink link={entry.txLink} /> : null}
      {showDetail ? <p className="dapp-log-detail">{entry.detail}</p> : null}
    </article>
  );
}

/** Fixed activity sheet for tx / info / error / announce. */
export function DappLogToaster() {
  const [entries, setEntries] = useState<DappLogEntry[]>([]);
  const [open, setOpen] = useState(true);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const ingest = useCallback(
    (input: DappLogInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry: DappLogEntry = {
        ...input,
        id,
        at: Date.now(),
      };
      setEntries((prev) => {
        const next = [entry, ...prev];
        return next.slice(0, MAX_VISIBLE);
      });
      setOpen(true);

      const ttl = input.ttlMs ?? defaultTtlMs(input.kind);
      if (ttl > 0) {
        const timer = window.setTimeout(() => dismiss(id), ttl);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => subscribeDappLog(ingest), [ingest]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  if (entries.length === 0) return null;

  const errorCount = entries.filter((e) => e.kind === "error").length;

  return (
    <aside className="dapp-log-toaster" aria-label="Dapp activity log" aria-live="polite">
      <div className="dapp-log-shell">
        <div className="dapp-log-shell-head">
          <p className="label">dapp log</p>
          <span className="dapp-log-count">
            {entries.length}
            {errorCount ? ` · ${errorCount} err` : ""}
          </span>
          <div className="dapp-log-actions">
            <button
              type="button"
              className="dapp-log-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="dapp-log-toggle"
              onClick={() => {
                for (const timer of timersRef.current.values()) window.clearTimeout(timer);
                timersRef.current.clear();
                setEntries([]);
              }}
            >
              Clear
            </button>
          </div>
        </div>
        {open ? (
          <div className="dapp-log-stack">
            {entries.map((entry) => (
              <LogCard key={entry.id} entry={entry} onDismiss={dismiss} />
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
