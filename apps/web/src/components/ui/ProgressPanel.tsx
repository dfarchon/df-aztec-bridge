import { useEffect, useRef, useState } from "react";
import {
  displayProgressAt,
  formatElapsed,
  getTrack,
  PROGRESS_STEP_DWELL_MS,
  shouldBlockUnload,
  stepStateAt,
  stripProgressDashes,
  type ProgressState,
  type ProgressStepState,
} from "../../lib/progress-track.ts";
import { WALLET_TX_REJECTED_DETAIL, WALLET_TX_REJECTED_TITLE } from "../../lib/app-error-toast.ts";
import { AztecBlockEstimate } from "./AztecBlockEstimate.tsx";
import { formatFjAmount } from "../../lib/bridge-amount.ts";
import { shortHash } from "../../lib/claim-recovery.ts";
import { getNetwork } from "../../config/networks.ts";
import { aztecExplorerLinkLabel, aztecScanAddressUrl } from "../../lib/official-links.ts";

interface ProgressPanelProps {
  progress: ProgressState;
  /** Free-form message from the running flow, shown verbatim under the steps. */
  detail: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
  /** After a finished L1 bridge, start the in-tab L2 claim. */
  onClaimL2?: () => void;
  /** When set, show Aztec tip + next-block countdown for L2 claim tracks. */
  aztecNodeUrl?: string | null;
  networkId?: string;
  /** Recipient of the claim whose confirmed balance should be shown. */
  claimRecipient?: string | null;
  /** Render inside an existing pane instead of a full-screen overlay. */
  embedded?: boolean;
}

function markerFor(state: ProgressStepState, index: number) {
  switch (state) {
    case "done":
      return "\u2713";
    case "failed":
      return "!";
    case "active":
      return "";
    default:
      return String(index + 1);
  }
}

function showAztecEstimate(track: ProgressState["track"]): boolean {
  return track === "claim" || track === "wait-l2";
}

function progressCaughtUp(shown: ProgressState, target: ProgressState): boolean {
  return (
    shown.track === target.track &&
    shown.stepIndex === target.stepIndex &&
    shown.runState === target.runState &&
    shown.txSubmitted === target.txSubmitted &&
    shown.combinedFlow === target.combinedFlow &&
    shown.serverClaim === target.serverClaim &&
    shown.alreadyClaimed === target.alreadyClaimed
  );
}

function usePacedProgress(progress: ProgressState): ProgressState {
  const [shown, setShown] = useState(progress);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const targetRef = useRef(progress);
  targetRef.current = progress;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        const { next, dwell } = displayProgressAt(shownRef.current, targetRef.current);
        if (!dwell) {
          if (!progressCaughtUp(shownRef.current, next)) {
            shownRef.current = next;
            setShown(next);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, PROGRESS_STEP_DWELL_MS));
        if (cancelled) return;
        shownRef.current = next;
        setShown(next);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [progress.track, progress.stepIndex, progress.runState, progress.txSubmitted, progress.combinedFlow, progress.serverClaim, progress.alreadyClaimed]);

  return shown;
}

function elapsedFor(progress: ProgressState, now: number): number {
  return progress.runState === "running"
    ? now - progress.stepStartedAt
    : (progress.finishedAt ?? now) - progress.startedAt;
}

export function ProgressPanel({
  progress: liveProgress,
  detail,
  onDismiss,
  onRetry,
  onClaimL2,
  aztecNodeUrl,
  networkId,
  claimRecipient,
  embedded = false,
}: ProgressPanelProps) {
  const progress = usePacedProgress(liveProgress);
  const running = progress.runState === "running";
  const rejected = progress.runState === "rejected";
  const failed = progress.runState === "failed";
  const [elapsed, setElapsed] = useState(() => elapsedFor(liveProgress, Date.now()));
  const [openStage, setOpenStage] = useState<"bridge" | "claim">(
    progress.track === "claim" ? "claim" : "bridge",
  );

  useEffect(() => {
    if (progress.combinedFlow && (progress.track === "bridge" || progress.track === "claim")) {
      setOpenStage(progress.track);
    }
  }, [progress.combinedFlow, progress.track]);

  useEffect(() => {
    const tick = () => setElapsed(elapsedFor(liveProgress, Date.now()));
    tick();
    if (liveProgress.runState !== "running") return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [liveProgress.runState, liveProgress.startedAt, liveProgress.stepStartedAt, liveProgress.finishedAt]);

  const track = getTrack(progress.track);
  const activeStep = track.steps[progress.stepIndex] ?? track.steps[0];
  const estimate =
    running && showAztecEstimate(progress.track) && aztecNodeUrl ? (
      <AztecBlockEstimate aztecNodeUrl={aztecNodeUrl} networkId={networkId} />
    ) : null;

  const renderSteps = (state: ProgressState) => (
    <ol className="progress-steps">
      {getTrack(state.track).steps.map((step, index) => {
        const stepState = stepStateAt(index, state);
        return (
          <li key={step.key} className={`progress-step progress-step-${stepState}`}>
            <span className="progress-step-marker" aria-hidden="true">{markerFor(stepState, index)}</span>
            <span className="progress-step-body">
              <span className="progress-step-label">{step.label}</span>
              {stepState === "active" && step.note ? (
                <span className="progress-step-note">{stripProgressDashes(step.note)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const panel = (
      <section
        className={`progress-panel progress-panel-${progress.runState}${embedded ? " progress-panel-embedded" : ""}`}
        aria-label={rejected ? WALLET_TX_REJECTED_TITLE : progress.combinedFlow ? "Bridge and claim Fee Juice" : track.title}
      >
        {running ? <span className="progress-panel-bar" aria-hidden="true" /> : null}

        <div className="progress-panel-head">
          {running ? (
            <span className="progress-spinner" aria-hidden="true" />
          ) : (
            <span className="progress-panel-badge" aria-hidden="true">
              {progress.runState === "succeeded" ? "\u2713" : "!"}
            </span>
          )}
          <div className="progress-panel-title">
            <strong className="wallet-manager-pane-title">
              {rejected ? WALLET_TX_REJECTED_TITLE : progress.combinedFlow ? "Bridge and claim Fee Juice" : track.title}
            </strong>
            <p className="hint progress-panel-step" role="status" aria-live="polite">
              {rejected
                ? WALLET_TX_REJECTED_DETAIL
                : progress.alreadyClaimed
                  ? "Already claimed · no new transaction needed"
                  : `Step ${progress.stepIndex + 1} of ${track.steps.length} · ${activeStep?.label}`}
            </p>
          </div>
          <span className="hint progress-elapsed" title={liveProgress.runState === "running" ? "Current step time" : "Total elapsed time"}>
            {formatElapsed(elapsed)}
          </span>
          {running ? null : (
            <button
              type="button"
              className="icon-btn utility-control"
              aria-label="Dismiss progress"
              title="Dismiss"
              onClick={onDismiss}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                />
              </svg>
            </button>
          )}
        </div>

        {running ? (
          shouldBlockUnload(progress) ? (
            <p className="hint progress-notice progress-notice-warn">
              <strong>Do not refresh or close this tab.</strong> This step runs inside the tab.
              Leaving now throws the work away and the flow has to start over from the beginning.
            </p>
          ) : (
            <p className="hint progress-notice progress-notice-safe">
              <strong>Safe to leave now.</strong>{" "}
              {progress.serverClaim
                ? "The claim job is running on the server. You can return to check its status."
                : progress.txSubmitted
                ? "The claim transaction is already on L2. It finishes on its own, and you can come back to the Recover tab to watch for confirmation."
                : "This step only re-reads data from the chain, so you can close the tab and pick it up again later."}
            </p>
          )
        ) : null}

        {progress.combinedFlow ? (
          <div className="progress-stages">
            {(["bridge", "claim"] as const).map((stage) => {
              const active = progress.track === stage;
              const finished = stage === "bridge" && progress.track === "claim";
              const state: ProgressState = active
                ? progress
                : { ...progress, track: stage, stepIndex: finished ? getTrack(stage).steps.length - 1 : 0,
                    runState: finished ? "succeeded" : "running", txSubmitted: false };
              const label = stage === "bridge" ? "L1 · Bridge" : "L2 · Claim";
              const stageStatus = finished || (active && progress.runState === "succeeded")
                ? "completed"
                : active ? (running ? "active" : "stopped") : "waiting";
              const expanded = openStage === stage;
              return (
                <section key={stage} className="progress-stage">
                  <button
                    type="button"
                    className="progress-stage-toggle"
                    aria-expanded={openStage === stage}
                    onClick={() => setOpenStage(openStage === stage ? (stage === "bridge" ? "claim" : "bridge") : stage)}
                  >
                    <span>{label}</span>
                    <span className="progress-stage-meta">
                      <span className={`progress-stage-status is-${stageStatus}`}>
                        {stageStatus === "completed" ? "Completed" : stageStatus === "active" ? "In progress" : stageStatus === "stopped" ? "Stopped" : "Waiting"}
                      </span>
                      <svg className={`progress-stage-chevron${expanded ? " is-open" : ""}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  <div className={`progress-stage-drawer${expanded ? " is-open" : ""}`} aria-hidden={!expanded} inert={!expanded}>
                    <div className="progress-stage-drawer-inner">
                      {stage === "claim" && progress.track === "bridge"
                        ? <p className="hint progress-stage-waiting">Waiting for the L1 bridge to complete.</p>
                        : stage === "claim" && progress.alreadyClaimed
                          ? <p className="hint progress-stage-waiting">The claim message was already consumed. No new L2 transaction was sent.</p>
                          : renderSteps(state)}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        ) : progress.alreadyClaimed ? (
          <p className="hint progress-stage-waiting">The claim message was already consumed. No new L2 transaction was sent.</p>
        ) : renderSteps(progress)}

        {estimate}

        {detail && (!rejected || detail !== WALLET_TX_REJECTED_DETAIL) ? (
          <p className="hint progress-detail">{stripProgressDashes(detail)}</p>
        ) : null}

        {progress.runState === "succeeded" ? (
          <div className="progress-panel-actions progress-panel-success-actions">
            {progress.track === "claim" || progress.track === "wait-l2" ? (
              <div className="progress-success-copy">
                <p className="progress-success-line">{progress.alreadyClaimed ? "🎉 Fee Juice already claimed" : "🎉 Fee Juice claimed"}{claimRecipient ? <> for <span className="progress-success-address" title={claimRecipient}>{shortHash(claimRecipient)}</span></> : null}</p>
                {claimRecipient && aztecNodeUrl ? (
                  <ClaimBalance recipient={claimRecipient} aztecNodeUrl={aztecNodeUrl} networkId={networkId} />
                ) : null}
              </div>
            ) : null}
            {progress.track === "bridge" && !progress.combinedFlow && onClaimL2 ? (
              <button type="button" className="ghost" onClick={onClaimL2}>
                Claim on L2
              </button>
            ) : null}
            <button type="button" onClick={onDismiss}>OK</button>
          </div>
        ) : null}

        {rejected || failed ? (
          <div className="progress-panel-actions">
            <button type="button" className="ghost" onClick={onDismiss}>
              Close
            </button>
            {onRetry ? (
              <button type="button" onClick={onRetry}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
  );

  if (embedded) return panel;
  return <div className="progress-panel-backdrop">{panel}</div>;
}

function ClaimBalance({ recipient, aztecNodeUrl, networkId }: { recipient: string; aztecNodeUrl: string; networkId?: string }) {
  const [result, setResult] = useState<{ key: string; balance: bigint | null; error: boolean } | null>(null);
  const key = `${aztecNodeUrl}\n${recipient.toLowerCase()}`;

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void (async () => {
      try {
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { getAztecFeeJuiceBalance } = await loadBrowserClaim();
        const balance = await getAztecFeeJuiceBalance({ aztecNodeUrl, aztecAddress: recipient });
        if (!cancelled) setResult({ key, balance, error: false });
      } catch {
        if (!cancelled) setResult({ key, balance: null, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [aztecNodeUrl, recipient, key]);

  const current = result?.key === key ? result : null;
  return (
    <div className="hint progress-claim-balance" role="status">
      {current?.error ? "Balance unavailable" : current?.balance != null
        ? `Balance ${formatFjAmount(current.balance, 5)} FJ`
        : "Loading balance…"}
      {current?.error && networkId ? (
        <> · <a href={aztecScanAddressUrl(networkId, recipient, getNetwork(networkId).aztecExplorerUrl)} target="_blank" rel="noopener noreferrer">View on {aztecExplorerLinkLabel(getNetwork(networkId).aztecExplorerUrl)} ↗</a></>
      ) : null}
    </div>
  );
}
