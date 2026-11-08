import { useLayoutEffect, useRef, useState } from "react";

/**
 * One-line hint. When the sentence is wider than the row, it holds, then
 * scrolls slowly so the rest can be read, then repeats.
 * Duration is set via CSSOM (not a style= attribute) so CSP style-src can stay tight.
 */
export function MarqueeHint(props: { id?: string; className?: string; text: string }) {
  const { id, className, text } = props;
  const rootRef = useRef<HTMLParagraphElement>(null);
  const viewportRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    const root = rootRef.current;
    if (!viewport || !measure || !root) return;

    const update = () => {
      const need = measure.scrollWidth > viewport.clientWidth + 2;
      setOverflow(need);
      const durationSec = Math.max(18, Math.min(42, measure.scrollWidth / 24));
      if (need) root.style.setProperty("--marquee-hint-duration", `${durationSec}s`);
      else root.style.removeProperty("--marquee-hint-duration");
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [text]);

  return (
    <p
      ref={rootRef}
      id={id}
      className={`marquee-hint${overflow ? " is-overflow" : ""}${className ? ` ${className}` : ""}`}
      title={text}
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
