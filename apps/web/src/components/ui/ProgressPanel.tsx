import { useEffect, useRef, useState } from "react";
import {
  displayProgressAt,
  formatElapsed,
  getTrack,
  PROGRESS_STEP_DWELL_MS,
  shouldBlockUnload,
  stepStateAt,
  type ProgressState,
  type ProgressStepState,
} from "../../lib/progress-track.ts";
import { AztecBlockEstimate } from "./AztecBlockEstimate.tsx";

interface ProgressPanelProps {
  progress: ProgressState;
  /** Free-form message from the running flow, shown verbatim under the steps. */
  detail: string | null;
  onDismiss: () => void;
  /** When set, show Aztec tip + next-block countdown for L2 claim tracks. */
  aztecNodeUrl?: string | null;
  networkId?: string;
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
    shown.txSubmitted === target.txSubmitted
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
  }, [progress.track, progress.stepIndex, progress.runState, progress.txSubmitted]);

  return shown;
}

export function ProgressPanel({
  progress: liveProgress,
  detail,
  onDismiss,
  aztecNodeUrl,
  networkId,
}: ProgressPanelProps) {
  const progress = usePacedProgress(liveProgress);
  const running = progress.runState === "running";
  const [elapsed, setElapsed] = useState(() => Date.now() - liveProgress.startedAt);

  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(Date.now() - liveProgress.startedAt);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [running, liveProgress.startedAt]);

  const track = getTrack(progress.track);
  const activeStep = track.steps[progress.stepIndex] ?? track.steps[0];
  const estimate =
    running && showAztecEstimate(progress.track) && aztecNodeUrl ? (
      <AztecBlockEstimate aztecNodeUrl={aztecNodeUrl} networkId={networkId} />
    ) : null;

  return (
    <div className="progress-panel-backdrop">
      <section
        className={`progress-panel progress-panel-${progress.runState}`}
        aria-label={track.title}
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
            <strong className="wallet-manager-pane-title">{track.title}</strong>
            <p className="hint progress-panel-step" role="status" aria-live="polite">
              Step {progress.stepIndex + 1} of {track.steps.length} · {activeStep?.label}
            </p>
          </div>
          <span className="hint progress-elapsed" title="Elapsed time">
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

        {estimate}

        {running ? (
          shouldBlockUnload(progress) ? (
            <p className="hint progress-notice progress-notice-warn">
              <strong>Do not refresh or close this tab.</strong> This step runs inside the tab.
              Leaving now throws the work away and the flow has to start over from the beginning.
            </p>
          ) : (
            <p className="hint progress-notice progress-notice-safe">
              <strong>Safe to leave now.</strong>{" "}
              {progress.txSubmitted
                ? "The claim transaction is already on L2. It finishes on its own, and you can come back to the Recover tab to watch for confirmation."
                : "This step only re-reads data from the chain, so you can close the tab and pick it up again later."}
            </p>
          )
        ) : null}

        <ol className="progress-steps">
          {track.steps.map((step, index) => {
            const state = stepStateAt(index, progress);
            return (
              <li key={step.key} className={`progress-step progress-step-${state}`}>
                <span className="progress-step-marker" aria-hidden="true">
                  {markerFor(state, index)}
                </span>
                <span className="progress-step-body">
                  <span className="progress-step-label">{step.label}</span>
                  {state === "active" && step.note ? (
                    <span className="progress-step-note">{step.note}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>

        {detail ? <p className="hint progress-detail">{detail}</p> : null}
      </section>
    </div>
  );
}
