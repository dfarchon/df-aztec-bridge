import { useEffect, useId, useMemo, useState } from "react";
import {
  buildAztecRpcOptions,
  CHAINLIST_AZTEC_PAGE,
  fetchChainlistAztecRpcs,
  type ChainlistRpcOption,
} from "../../lib/chainlist-aztec-rpcs.ts";
import { pushDappLog } from "../../lib/dapp-log.ts";

export type RpcFetchStatus = "idle" | "fetching" | "ok" | "error";

export function AztecRpcOptionsField(props: {
  value: string;
  networkDefaultUrl: string;
  /** Shown after network default (e.g. public dRPC when default is authenticated). */
  preferredUrls?: string[];
  onChange: (url: string) => void;
  disabled?: boolean;
}) {
  const { value, networkDefaultUrl, preferredUrls, onChange, disabled } = props;
  const listId = useId();
  const [status, setStatus] = useState<RpcFetchStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [chainlistUrls, setChainlistUrls] = useState<string[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    setStatus("fetching");
    setError(null);
    pushDappLog({
      kind: "info",
      title: "Fetching Aztec RPCs",
      detail: "Loading Chainlist registry for Aztec Mainnet (chainId 677868)…",
      ttlMs: 6_000,
    });
    void fetchChainlistAztecRpcs({ signal: ac.signal })
      .then((urls) => {
        setChainlistUrls(urls);
        setStatus("ok");
        pushDappLog({
          kind: "announce",
          title: "Chainlist Aztec RPCs ready",
          detail:
            urls.length > 0
              ? `Loaded ${urls.length} HTTPS option(s). Official list: ${CHAINLIST_AZTEC_PAGE}`
              : `No HTTPS RPCs in Chainlist yet. Using current / network default. ${CHAINLIST_AZTEC_PAGE}`,
          ttlMs: 12_000,
        });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setStatus("error");
        setError(msg);
        pushDappLog({
          kind: "error",
          title: "Chainlist RPC fetch failed",
          detail: `${msg}. Keep the current URL or open ${CHAINLIST_AZTEC_PAGE}`,
        });
      });
    return () => ac.abort();
  }, []);

  const options = useMemo(
    () =>
      buildAztecRpcOptions({
        currentUrl: value,
        networkDefaultUrl,
        preferredUrls,
        chainlistUrls,
      }),
    [value, networkDefaultUrl, preferredUrls, chainlistUrls],
  );

  const statusTitle =
    status === "fetching"
      ? "Fetching Chainlist…"
      : status === "ok"
        ? "Chainlist fetched"
        : status === "error"
          ? error ?? "Fetch failed"
          : "Idle";

  return (
    <div className="rpc-aztec-field">
      <div className="rpc-aztec-field-head">
        <span className="rpc-aztec-label">AZTEC_NODE_URL</span>
        <span
          className={`rpc-status-dot rpc-status-${status}`}
          title={statusTitle}
          role="status"
          aria-label={statusTitle}
        >
          {status === "error" ? (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
              />
            </svg>
          ) : status === "fetching" ? (
            <span className="rpc-status-spinner" aria-hidden="true" />
          ) : (
            <span className="rpc-status-circle" aria-hidden="true" />
          )}
        </span>
      </div>

      <div className="rpc-aztec-controls">
        <select
          className="rpc-aztec-select"
          value={options.some((o) => o.url === value.trim().replace(/\/$/, "")) ? value.trim().replace(/\/$/, "") : value}
          disabled={disabled || options.length === 0}
          aria-label="Aztec node URL options"
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            const opt = options.find((o) => o.url === next);
            pushDappLog({
              kind: "info",
              title: "Aztec RPC selected",
              detail: `${opt?.label ?? "Custom"} → ${next}`,
              ttlMs: 7_000,
            });
          }}
        >
          {options.map((o: ChainlistRpcOption) => (
            <option key={`${o.source}:${o.url}`} value={o.url}>
              {o.label}: {o.url}
            </option>
          ))}
        </select>
        <input
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={networkDefaultUrl}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-label="Aztec node URL"
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={`dl:${o.url}`} value={o.url} />
          ))}
        </datalist>
      </div>

      <p className="hint rpc-aztec-link-row">
        Official Chainlist Aztec RPCs:{" "}
        <a href={CHAINLIST_AZTEC_PAGE} target="_blank" rel="noopener noreferrer">
          chainlist.org/chain/677868
        </a>
        {status === "error" && error ? (
          <>
            {" "}
            — <span className="error">{error}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
