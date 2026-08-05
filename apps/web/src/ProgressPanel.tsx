import { useEffect, useState } from "react";
import {
  formatElapsed,
  getTrack,
  shouldBlockUnload,
  stepStateAt,
  type ProgressState,
  type ProgressStepState,
} from "./lib/progress-track.js";

interface ProgressPanelProps {
  progress: ProgressState;
  /** Free-form message from the running flow, shown verbatim under the steps. */
  detail: string | null;
  onDismiss: () => void;
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

export function ProgressPanel({ progress, detail, onDismiss }: ProgressPanelProps) {
  const running = progress.runState === "running";
  const [collapsed, setCollapsed] = useState(false);
  const [elapsed, setElapsed] = useState(() => Date.now() - progress.startedAt);

  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(Date.now() - progress.startedAt);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [running, progress.startedAt]);

  const track = getTrack(progress.track);
  const activeStep = track.steps[progress.stepIndex] ?? track.steps[0];

  return (
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
          <strong>{track.title}</strong>
          <p className="progress-panel-step" role="status" aria-live="polite">
            Step {progress.stepIndex + 1} of {track.steps.length} &middot; {activeStep?.label}
          </p>
        </div>
        <span className="progress-elapsed mono" title="Elapsed time">
          {formatElapsed(elapsed)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show all steps" : "Hide step details"}
          title={collapsed ? "Show all steps" : "Hide step details"}
          onClick={() => setCollapsed((value) => !value)}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            style={{ transform: collapsed ? "rotate(180deg)" : undefined }}
          >
            <path fill="currentColor" d="M12 15.5 5.5 9l1.4-1.4 5.1 5.1 5.1-5.1L18.5 9z" />
          </svg>
        </button>
        {running ? null : (
          <button
            type="button"
            className="icon-btn"
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
          <p className="progress-notice progress-notice-warn">
            <strong>Do not refresh or close this tab.</strong> This step runs inside the tab
            &mdash; leaving now throws the work away and the flow has to start over from the
            beginning.
          </p>
        ) : (
          <p className="progress-notice progress-notice-safe">
            <strong>Safe to leave now.</strong>{" "}
            {progress.txSubmitted
              ? "The claim transaction is already on L2. It finishes on its own, and you can come back to the Recover tab to watch for confirmation."
              : "This step only re-reads data from the chain, so you can close the tab and pick it up again later."}
          </p>
        )
      ) : null}

      <ol className={`progress-steps${collapsed ? " collapsed" : ""}`}>
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

      {detail && !collapsed ? <p className="progress-detail mono">{detail}</p> : null}
    </section>
  );
}
