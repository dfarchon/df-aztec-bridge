import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "../../app/router.tsx";
import {
  parseExplorerRoute,
  ROUTES,
  type ExplorerView,
} from "../../app/routes.ts";
import { getNetwork } from "../../config/networks.ts";
import { privacyWarn } from "../../lib/privacy.ts";
import {
  extractTxHashesFromBlock,
  fetchBlock,
  fetchTxEffect,
  prettyJson,
} from "./local-node-rpc.ts";
import { useLocalChainTip } from "./useLocalChainTip.ts";

const RECENT_COUNT = 12;

function localNodeUrl(): string {
  return getNetwork("local").aztecNodeUrl;
}

function shortHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function LocalExplorerPage(props: { path: string }) {
  const view = useMemo(
    () => parseExplorerRoute(props.path) ?? ({ kind: "index" } as ExplorerView),
    [props.path],
  );
  const nodeUrl = localNodeUrl();
  const tipState = useLocalChainTip(nodeUrl);

  if (view.kind === "index") {
    return <ExplorerIndex nodeUrl={nodeUrl} tipState={tipState} />;
  }
  if (view.kind === "block") {
    return (
      <ExplorerBlock
        nodeUrl={nodeUrl}
        blockNumber={view.blockNumber}
        tipState={tipState}
      />
    );
  }
  if (view.kind === "txEffect") {
    return (
      <ExplorerTxEffect
        nodeUrl={nodeUrl}
        txHash={view.txHash}
        tipState={tipState}
      />
    );
  }
  return <ExplorerAddress address={view.address} tipState={tipState} />;
}

type TipState = ReturnType<typeof useLocalChainTip>;

function ExplorerShell(props: {
  title: string;
  children: ReactNode;
  subtitle?: string;
  tipState: TipState;
}) {
  const { tip, intervalMs, busy } = props.tipState;
  return (
    <section className="route-page local-explorer" aria-label="Local explorer">
      <p className="label">local explorer</p>
      <h1>{props.title}</h1>
      {props.subtitle ? <p className="hint">{props.subtitle}</p> : null}
      <p className="hint local-explorer-live mono" role="status">
        Live tip{" "}
        {tip !== null ? <Link to={`/blocks/${tip}`}>{tip}</Link> : "—"}
        {" · "}
        bound to local-network-tick every {intervalMs}ms
        {busy ? " · refreshing…" : ""}
      </p>
      <p className="hint">
        AztecScan-shaped paths against your local node — not the full{" "}
        <a href="https://aztecscan.xyz/" target="_blank" rel="noopener noreferrer">
          aztecscan.xyz
        </a>{" "}
        indexer.{" "}
        <Link to={ROUTES.explorer}>Explorer home</Link>
        {" · "}
        <Link to={ROUTES.bridge}>Bridge</Link>
      </p>
      {props.children}
    </section>
  );
}

function ExplorerIndex(props: { nodeUrl: string; tipState: TipState }) {
  const { tipState } = props;
  const { tip, info, error, busy, refresh } = tipState;

  const recent = useMemo(() => {
    if (tip === null || tip < 0) return [];
    const start = Math.max(0, tip - RECENT_COUNT + 1);
    const nums: number[] = [];
    for (let n = tip; n >= start; n -= 1) nums.push(n);
    return nums;
  }, [tip]);

  return (
    <ExplorerShell
      title="Local network"
      subtitle={`JSON-RPC ${props.nodeUrl}`}
      tipState={tipState}
    >
      <div className="local-explorer-toolbar">
        <button type="button" className="ghost" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <dl className="local-explorer-meta mono">
        <div>
          <dt>Tip</dt>
          <dd>
            {tip !== null ? (
              <Link to={`/blocks/${tip}`}>{tip}</Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Node</dt>
          <dd>{info?.nodeVersion ?? "—"}</dd>
        </div>
        <div>
          <dt>L1 chain</dt>
          <dd>{info?.l1ChainId ?? "—"}</dd>
        </div>
        <div>
          <dt>Rollup</dt>
          <dd>{info?.rollupVersion ?? "—"}</dd>
        </div>
      </dl>
      <h2 className="local-explorer-subhead">Recent blocks</h2>
      {recent.length === 0 ? (
        <p className="hint">Waiting for tip…</p>
      ) : (
        <ul className="local-explorer-list mono">
          {recent.map((n) => (
            <li key={n}>
              <Link to={`/blocks/${n}`}>
                Block {n}
                {n === tip ? " · tip" : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ExplorerShell>
  );
}

function ExplorerBlock(props: {
  nodeUrl: string;
  blockNumber: number;
  tipState: TipState;
}) {
  const { nodeUrl, blockNumber, tipState } = props;
  const { tip, tipEpoch } = tipState;
  const navigate = useNavigate();
  const [block, setBlock] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** null until first tip known; then true only if this route opened/stayed on tip. */
  const followTipRef = useRef<boolean | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setBlock(await fetchBlock(nodeUrl, blockNumber));
    } catch (e) {
      privacyWarn("local-explorer/block", e);
      setError(e instanceof Error ? e.message : String(e));
      setBlock(null);
    } finally {
      setBusy(false);
    }
  }, [nodeUrl, blockNumber]);

  useEffect(() => {
    void load();
  }, [load, tipEpoch]);

  useEffect(() => {
    if (tip === null) return;
    if (followTipRef.current === null) {
      followTipRef.current = blockNumber === tip;
    }
    if (blockNumber === tip) {
      followTipRef.current = true;
      return;
    }
    if (followTipRef.current) {
      navigate(`/blocks/${tip}`, { replace: true });
    }
  }, [tip, blockNumber, navigate]);

  const txHashes = useMemo(() => extractTxHashesFromBlock(block), [block]);
  const isTip = tip !== null && blockNumber === tip;

  return (
    <ExplorerShell title={`Block ${blockNumber}`} tipState={tipState}>
      <div className="local-explorer-toolbar">
        <button type="button" className="ghost" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading…" : "Reload"}
        </button>
        {blockNumber > 0 ? (
          <Link
            to={`/blocks/${blockNumber - 1}`}
            onClick={() => {
              followTipRef.current = false;
            }}
          >
            ← prev
          </Link>
        ) : null}
        <Link
          to={`/blocks/${blockNumber + 1}`}
          onClick={() => {
            followTipRef.current = tip !== null && blockNumber + 1 >= tip;
          }}
        >
          next →
        </Link>
        {isTip ? <span className="hint mono">following tip</span> : null}
        {!isTip && tip !== null ? (
          <Link
            to={`/blocks/${tip}`}
            onClick={() => {
              followTipRef.current = true;
            }}
          >
            jump to tip {tip}
          </Link>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {txHashes.length ? (
        <>
          <h2 className="local-explorer-subhead">Tx effects</h2>
          <ul className="local-explorer-list mono">
            {txHashes.map((h) => (
              <li key={h}>
                <Link to={`/tx-effects/${h}`} title={h}>
                  {shortHash(h)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {block !== null ? (
        <pre className="local-explorer-json mono">{prettyJson(block)}</pre>
      ) : !error ? (
        <p className="hint">Loading block…</p>
      ) : null}
    </ExplorerShell>
  );
}

function ExplorerTxEffect(props: {
  nodeUrl: string;
  txHash: string;
  tipState: TipState;
}) {
  const { nodeUrl, txHash, tipState } = props;
  const { tipEpoch } = tipState;
  const [effect, setEffect] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setEffect(await fetchTxEffect(nodeUrl, txHash));
    } catch (e) {
      privacyWarn("local-explorer/tx", e);
      setError(e instanceof Error ? e.message : String(e));
      setEffect(null);
    } finally {
      setBusy(false);
    }
  }, [nodeUrl, txHash]);

  useEffect(() => {
    void load();
  }, [load, tipEpoch]);

  return (
    <ExplorerShell title="Tx effect" subtitle={txHash} tipState={tipState}>
      <div className="local-explorer-toolbar">
        <button type="button" className="ghost" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading…" : "Reload"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {effect !== null ? (
        <pre className="local-explorer-json mono">{prettyJson(effect)}</pre>
      ) : !error ? (
        <p className="hint">Loading tx effect…</p>
      ) : null}
    </ExplorerShell>
  );
}

function ExplorerAddress(props: { address: string; tipState: TipState }) {
  return (
    <ExplorerShell title="Address" subtitle={props.address} tipState={props.tipState}>
      <p className="hint">
        Local explorer has no indexer for address history. Tip updates with
        local-network-tick; use block / tx-effect views, or public{" "}
        <a href="https://aztecscan.xyz/" target="_blank" rel="noopener noreferrer">
          Aztec Scan
        </a>{" "}
        on mainnet/testnet.
      </p>
      <p className="mono">{props.address}</p>
    </ExplorerShell>
  );
}
