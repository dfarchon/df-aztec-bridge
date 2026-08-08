import { useCallback, useEffect, useRef, useState } from "react";
import { privacyWarn } from "../../lib/privacy.ts";
import {
  fetchBlockNumber,
  fetchNodeInfo,
  type LocalNodeInfo,
} from "./local-node-rpc.ts";

/** Match scripts/dev-common.sh LOCAL_TICK_INTERVAL_MS default. */
export function localTickIntervalMs(): number {
  const raw = import.meta.env.VITE_LOCAL_TICK_INTERVAL_MS;
  const n = Number(raw ?? "4000");
  return Math.max(1_000, Number.isFinite(n) && n > 0 ? n : 4_000);
}

/**
 * Poll local node tip on the same cadence as `pnpm tick:local` /
 * mprocs `tick` (LOCAL_TICK_INTERVAL_MS). `tipEpoch` bumps whenever the
 * tip advances so explorer routes can reload block/tx data.
 */
export function useLocalChainTip(nodeUrl: string) {
  const [tip, setTip] = useState<number | null>(null);
  const [info, setInfo] = useState<LocalNodeInfo | null>(null);
  const [tipEpoch, setTipEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastTipRef = useRef<number | null>(null);
  const intervalMs = localTickIntervalMs();

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [node, nextTip] = await Promise.all([
        fetchNodeInfo(nodeUrl),
        fetchBlockNumber(nodeUrl),
      ]);
      setInfo(node);
      setError(null);
      if (lastTipRef.current !== nextTip) {
        lastTipRef.current = nextTip;
        setTip(nextTip);
        setTipEpoch((e) => e + 1);
      } else {
        setTip(nextTip);
      }
    } catch (e) {
      privacyWarn("local-explorer/tip", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [nodeUrl]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;
    // Lag slightly behind the mine tick so tip has advanced before we read.
    const lagMs = Math.min(750, Math.max(200, Math.floor(intervalMs / 5)));

    const run = () => {
      if (!cancelled) void refresh();
    };

    const startId = window.setTimeout(() => {
      run();
      intervalId = window.setInterval(run, intervalMs);
    }, lagMs);

    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [refresh, intervalMs]);

  return { tip, info, tipEpoch, error, busy, intervalMs, refresh };
}
