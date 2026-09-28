import { useEffect, useState } from "react";

type Tip = { text: string; x: number; y: number; above: boolean };

/** Replaces the native white `title` tooltip with the identity theme tip. */
export function ThemeTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let host: HTMLElement | null = null;

    const restore = () => {
      if (host?.dataset.tip) {
        host.setAttribute("title", host.dataset.tip);
        delete host.dataset.tip;
      }
      host = null;
    };

    const place = (node: HTMLElement, text: string) => {
      const rect = node.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2));
      const above = rect.bottom + 44 > window.innerHeight;
      setTip({
        text,
        x,
        y: above ? rect.top - 8 : rect.bottom + 8,
        above,
      });
    };

    const show = (event: MouseEvent) => {
      const node = (event.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
      if (!node) return;
      const text = node.getAttribute("title") || node.dataset.tip;
      if (!text) return;
      if (host && host !== node) restore();
      if (node.getAttribute("title")) {
        node.dataset.tip = text;
        node.removeAttribute("title");
      }
      host = node;
      place(node, text);
    };

    const hide = (event: MouseEvent) => {
      if (!host) return;
      const next = event.relatedTarget;
      if (next instanceof Node && host.contains(next)) return;
      restore();
      setTip(null);
    };

    document.addEventListener("mouseover", show);
    document.addEventListener("mouseout", hide);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("mouseout", hide);
      restore();
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className={`theme-tip${tip.above ? " is-above" : ""}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
