import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeContext.tsx";

const GLYPHS = ["·", "·", "·", ":", "+", "*", "x", "0", "#"];

function hash(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function AsciiField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let width = 0;
    let height = 0;
    let lastDraw = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      if (time - lastDraw < 90 && !media.matches) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastDraw = time;
      context.clearRect(0, 0, width, height);
      context.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";

      const cell = width < 700 ? 19 : 17;
      const drift = media.matches ? 0 : time * 0.00008;
      const cols = Math.ceil(width / cell) + 1;
      const rows = Math.ceil(height / cell) + 1;

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const wave =
            Math.sin(x * 0.23 + drift * 20) +
            Math.cos(y * 0.19 - drift * 15) +
            Math.sin((x + y) * 0.09 + drift * 11);
          const value = (wave + 3) / 6 + hash(x, y) * 0.24;
          if (value < 0.52) continue;
          const glyph = GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(value * GLYPHS.length))];
          const alpha = Math.min(0.23, 0.035 + (value - 0.52) * 0.31);
          context.fillStyle =
            theme === "dark"
              ? `rgba(255, 91, 172, ${alpha})`
              : `rgba(116, 40, 76, ${Math.min(0.32, alpha * 1.35)})`;
          context.fillText(glyph, x * cell, y * cell);
        }
      }

      if (!media.matches) frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  return <canvas ref={canvasRef} className="ascii-field" aria-hidden="true" />;
}
