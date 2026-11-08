import { useEffect, useState } from "react";
import { AsciiClouds } from "./AsciiClouds.tsx";
import { AsciiGameOfLife } from "./AsciiGameOfLife.tsx";

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Follows `data-theme` so the field can paint before the app providers mount. */
export function AsciiField() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readTheme());
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);

  return theme === "light" ? <AsciiClouds /> : <AsciiGameOfLife />;
}
