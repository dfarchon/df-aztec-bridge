import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * One-line hint. When the sentence is wider than the row, it holds, then
 * scrolls slowly so the rest can be read, then repeats.
 */
export function MarqueeHint(props: { id?: string; className?: string; text: string }) {
  const { id, className, text } = props;
  const viewportRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [durationSec, setDurationSec] = useState(28);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;

    const update = () => {
      const need = measure.scrollWidth > viewport.clientWidth + 2;
      setOverflow(need);
      // About six characters a second through the moving part of the loop.
      setDurationSec(Math.max(18, Math.min(42, measure.scrollWidth / 24)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [text]);

  return (
    <p
      id={id}
      className={`marquee-hint${overflow ? " is-overflow" : ""}${className ? ` ${className}` : ""}`}
      title={text}
      style={
        overflow
          ? ({ "--marquee-hint-duration": `${durationSec}s` } as CSSProperties)
          : undefined
      }
    >
      <span className="marquee-hint-viewport" ref={viewportRef}>
        <span ref={measureRef} className="marquee-hint-measure" aria-hidden="true">
          {text}
        </span>
        <span className="marquee-hint-wave">
          <span className="marquee-hint-segment">{text}</span>
          {overflow ? (
            <span className="marquee-hint-segment" aria-hidden="true">
              {text}
            </span>
          ) : null}
        </span>
      </span>
    </p>
  );
}
