import { useCallback, useEffect, useRef, useState } from "react";
import { privacyFetch } from "../../lib/privacy.ts";
import {
  blendIntervalMs,
  defaultBlockIntervalMs,
  formatCountdown,
  paceFromRemaining,
  paceLabel,
  type BlockPace,
} from "../../lib/aztec-block-estimate.ts";

async function fetchTip(nodeUrl: string): Promise<number> {
  const res = await privacyFetch(nodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "node_getBlockNumber",
      params: [],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: number | string;
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return Number(body.result);
}

export function AztecBlockEstimate(props: {
  aztecNodeUrl: string;
  networkId?: string;
  /** Poll cadence for tip reads (ms). */
  pollMs?: number;
}) {
  const { aztecNodeUrl, networkId, pollMs = 2_000 } = props;
  const baselineMs = defaultBlockIntervalMs(networkId);
  const [tip, setTip] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [intervalMs, setIntervalMs] = useState(baselineMs);
  const [predictedAt, setPredictedAt] = useState(() => Date.now() + baselineMs);
  const lastTipAtRef = useRef<number | null>(null);
  const lastTipRef = useRef<number | null>(null);
  const intervalRef = useRef(baselineMs);

  useEffect(() => {
    intervalRef.current = baselineMs;
    setIntervalMs(baselineMs);
  }, [baselineMs]);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchTip(aztecNodeUrl);
      setError(null);
      const stamped = Date.now();
      const prevTip = lastTipRef.current;
      const prevAt = lastTipAtRef.current;

      let nextInterval = intervalRef.current;
      if (prevTip !== null && next > prevTip && prevAt != null) {
        const observed = (stamped - prevAt) / Math.max(1, next - prevTip);
        nextInterval = blendIntervalMs(observed, baselineMs);
        intervalRef.current = nextInterval;
        setIntervalMs(nextInterval);
      }

      if (prevTip === null || next !== prevTip) {
        lastTipRef.current = next;
        lastTipAtRef.current = stamped;
        setTip(next);
        setPredictedAt(stamped + nextInterval);
      } else {
        setTip(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [aztecNodeUrl, baselineMs]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void refresh();
    };
    run();
    const poll = window.setInterval(run, pollMs);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh, pollMs]);

  const remaining = predictedAt - now;
  const pace: BlockPace = paceFromRemaining(remaining, intervalMs);
  const countdown = formatCountdown(remaining);

  return (
    <div
      className={`aztec-block-estimate aztec-block-estimate-${pace}`}
      role="status"
      aria-live="polite"
      title={
        error
          ? `Tip poll failed: ${error}`
          : `Estimated ~${Math.round(intervalMs / 1000)}s between tips`
      }
    >
      <div className="aztec-block-estimate-row">
        <span className="aztec-block-estimate-label">Aztec tip</span>
        <span className="aztec-block-estimate-tip mono">
          {tip == null ? "…" : `#${tip}`}
        </span>
      </div>
      <div className="aztec-block-estimate-row">
        <span className="aztec-block-estimate-label">Next tip</span>
        <span className="aztec-block-estimate-timer mono">{countdown}</span>
        <span className="aztec-block-estimate-pace">{paceLabel(pace)}</span>
      </div>
      <div className="aztec-block-estimate-meter" aria-hidden="true">
        <span
          className="aztec-block-estimate-fill"
          style={{
            width: `${Math.max(
              0,
              Math.min(100, ((intervalMs - Math.max(0, remaining)) / intervalMs) * 100),
            )}%`,
          }}
        />
      </div>
    </div>
  );
}
