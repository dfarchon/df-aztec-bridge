import { useEffect } from "react";

/** Keeps `title` off the pointer so neither the themed tip nor the native tooltip appears. */
export function ThemeTooltip() {
  useEffect(() => {
    let host: HTMLElement | null = null;

    const restore = () => {
      if (host?.dataset.tip) {
        host.setAttribute("title", host.dataset.tip);
        delete host.dataset.tip;
      }
      host = null;
    };

    const show = (event: MouseEvent) => {
      const node = (event.target as Element | null)?.closest?.("[title]") as HTMLElement | null;
      if (!node) return;
      const text = node.getAttribute("title");
      if (!text) return;
      if (host && host !== node) restore();
      node.dataset.tip = text;
      node.removeAttribute("title");
      host = node;
    };

    const hide = (event: MouseEvent) => {
      if (!host) return;
      const next = event.relatedTarget;
      if (next instanceof Node && host.contains(next)) return;
      restore();
    };

    document.addEventListener("mouseover", show);
    document.addEventListener("mouseout", hide);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("mouseout", hide);
      restore();
    };
  }, []);

  return null;
}
