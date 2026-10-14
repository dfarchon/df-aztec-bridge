import { useCallback, useEffect, useState } from "react";
import {
  APP_ERROR_TOAST_MAX,
  subscribeAppError,
  type AppErrorToast,
  type AppErrorToastInput,
} from "../../lib/app-error-toast.ts";

export function AppErrorToastList(props: {
  entries: AppErrorToast[];
  onDismiss: (id: string) => void;
}) {
  const { entries, onDismiss } = props;
  if (entries.length === 0) return null;
  return (
    <aside className="app-error-toaster" aria-label="Errors" aria-live="assertive">
      {entries.map((entry) => (
        <article key={entry.id} className="app-error-toast" role="alert">
          <div className="app-error-toast-body">
            <p className="app-error-toast-title">{entry.title}</p>
            {entry.detail ? <p className="app-error-toast-detail">{entry.detail}</p> : null}
          </div>
          <button
            type="button"
            className="app-error-toast-dismiss"
            aria-label="Dismiss error"
            onClick={() => onDismiss(entry.id)}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
              />
            </svg>
          </button>
        </article>
      ))}
    </aside>
  );
}

export function AppErrorToaster() {
  const [entries, setEntries] = useState<AppErrorToast[]>([]);

  const dismiss = useCallback((id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const ingest = useCallback((input: AppErrorToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: AppErrorToast = {
      ...input,
      id,
      at: Date.now(),
    };
    setEntries((prev) => [entry, ...prev].slice(0, APP_ERROR_TOAST_MAX));
  }, []);

  useEffect(() => subscribeAppError(ingest), [ingest]);

  return <AppErrorToastList entries={entries} onDismiss={dismiss} />;
}
