import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Primary CTA when ready; otherwise a black / green “what to do next” hint.
 * Long hint text slowly marquee-waves when it overflows the bar.
 */
export function ActionHintButton(props: {
  label: string;
  ready: boolean;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const { label, ready, busy = false, onClick, className } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [durationSec, setDurationSec] = useState(24);

  useLayoutEffect(() => {
    if (ready) {
      setOverflow(false);
      return;
    }
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;

    const update = () => {
      const need = measure.scrollWidth > viewport.clientWidth + 2;
      setOverflow(need);
      setDurationSec(Math.max(18, Math.min(48, measure.scrollWidth / 30)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [label, ready]);

  if (ready) {
    return (
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={onClick}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`action-hint${overflow ? " is-overflow" : ""}${className ? ` ${className}` : ""}`}
      disabled={busy}
      onClick={onClick}
      title={label}
      aria-label={label}
      style={
        overflow
          ? ({ "--action-hint-duration": `${durationSec}s` } as CSSProperties)
          : undefined
      }
    >
      <span className="action-hint-viewport" ref={viewportRef}>
        <span ref={measureRef} className="action-hint-measure" aria-hidden="true">
          {label}
        </span>
        <span className="action-hint-wave">
          <span className="action-hint-segment">{label}</span>
          {overflow ? (
            <span className="action-hint-segment" aria-hidden="true">
              {label}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
