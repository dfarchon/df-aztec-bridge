import { useEffect, useRef, useState } from "react";

const SYMBOLS = "!@#$%^&*+={}[]<>/\\01";

/** Identity-page name hover: characters scramble, then resolve. */
export function DecodeText(props: { children: string }) {
  const source = props.children;
  const [text, setText] = useState(source);
  const animation = useRef(0);

  useEffect(() => {
    setText(source);
    return () => cancelAnimationFrame(animation.current);
  }, [source]);

  const decode = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - started) / 520, 1);
      setText(
        [...source]
          .map((character, index) => {
            if (/\s/.test(character) || index / source.length < progress) return character;
            return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
          })
          .join(""),
      );
      if (progress < 1) animation.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(animation.current);
    animation.current = requestAnimationFrame(tick);
  };

  return (
    <span className="decode-text" onMouseEnter={decode} onFocus={decode} tabIndex={0}>
      {text}
    </span>
  );
}
