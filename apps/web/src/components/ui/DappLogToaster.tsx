import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  defaultTtlMs,
  subscribeDappLog,
  type DappLogEntry,
  type DappLogInput,
  type DappLogKind,
} from "../../lib/dapp-log.ts";

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

function LogLine(props: { text: string; className?: string }) {
  const { text, className } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [durationSec, setDurationSec] = useState(22);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;
    const update = () => {
      const need = measure.scrollWidth > viewport.clientWidth + 2;
      setOverflow(need);
      setDurationSec(Math.max(16, Math.min(42, measure.scrollWidth / 32)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div
      className={`dapp-log-line${overflow ? " is-overflow" : ""}${className ? ` ${className}` : ""}`}
      ref={viewportRef}
      title={text}
      style={
        overflow
          ? ({ "--dapp-log-wave-duration": `${durationSec}s` } as CSSProperties)
          : undefined
      }
    >
      <span ref={measureRef} className="dapp-log-measure" aria-hidden="true">
        {text}
      </span>
      <div className="dapp-log-wave">
        <span className="dapp-log-segment">{text}</span>
        {overflow ? (
          <span className="dapp-log-segment" aria-hidden="true">
            {text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LogCard(props: {
  entry: DappLogEntry;
  onDismiss: (id: string) => void;
}) {
  const { entry, onDismiss } = props;
  return (
    <article className={`dapp-log-card dapp-log-${entry.kind}`} role="status">
      <header className="dapp-log-card-head">
        <span className="dapp-log-kind mono">{kindLabel(entry.kind)}</span>
        <time className="dapp-log-time mono" dateTime={new Date(entry.at).toISOString()}>
          {new Date(entry.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </time>
        <button
          type="button"
          className="icon-btn dapp-log-dismiss"
          aria-label="Dismiss log"
          title="Dismiss"
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
      <LogLine text={entry.title} className="dapp-log-title" />
      {entry.detail ? <LogLine text={entry.detail} className="dapp-log-detail" /> : null}
    </article>
  );
}

/** Fixed atlas-style toast stack for tx / info / error / announce. */
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
          <span className="dapp-log-count mono">
            {entries.length}
            {errorCount ? ` · ${errorCount} err` : ""}
          </span>
          <button
            type="button"
            className="ghost dapp-log-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            className="ghost dapp-log-toggle"
            onClick={() => {
              for (const timer of timersRef.current.values()) window.clearTimeout(timer);
              timersRef.current.clear();
              setEntries([]);
            }}
          >
            Clear
          </button>
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
