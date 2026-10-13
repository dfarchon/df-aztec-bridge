import { useEffect, useRef } from "react";
import { CHAR_H, CHAR_W, FONT_SIZE, fbm, lerp } from "./ascii-noise.ts";

const CHARS = ".,·:;-=+*%#@&";

function pickChar(density: number): string {
  const i = Math.floor(density * (CHARS.length - 1));
  return CHARS[Math.min(i, CHARS.length - 1)];
}

export function AsciiClouds() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseX = useRef(0);
  const mouseY = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const view = canvas;
    const context = ctx;

    const LAYERS = [
      { speed: 0.025, scale: 1.8, seed: 0, threshold: 0.4, alpha: 0.55 },
      { speed: 0.05, scale: 2.4, seed: 50, threshold: 0.36, alpha: 0.7 },
      { speed: 0.09, scale: 3.2, seed: 100, threshold: 0.33, alpha: 0.85 },
      { speed: 0.15, scale: 4.5, seed: 170, threshold: 0.3, alpha: 1.0 },
    ];
    const PAINT_RADIUS = 6;
    const DECAY = 0.985;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let cols = 0;
    let rows = 0;
    let w = 0;
    let h = 0;
    let animId = 0;
    let influence = new Float32Array(0);
    let prevMX = mouseX.current;
    let prevMY = mouseY.current;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      view.width = w * dpr;
      view.height = h * dpr;
      view.style.width = `${w}px`;
      view.style.height = `${h}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CHAR_W) + 1;
      rows = Math.ceil(h / CHAR_H) + 1;
      influence = new Float32Array(cols * rows);
    }

    function paintInfluence() {
      if (motion.matches) return;
      const curMX = mouseX.current;
      const curMY = mouseY.current;
      const dmx = curMX - prevMX;
      const dmy = curMY - prevMY;
      if (dmx * dmx + dmy * dmy <= 1) return;
      const mcol = Math.round(curMX / CHAR_W);
      const mrow = Math.round(curMY / CHAR_H);
      const r2 = PAINT_RADIUS * PAINT_RADIUS;
      for (let rr = Math.max(0, mrow - PAINT_RADIUS); rr <= Math.min(rows - 1, mrow + PAINT_RADIUS); rr++) {
        for (let cc = Math.max(0, mcol - PAINT_RADIUS); cc <= Math.min(cols - 1, mcol + PAINT_RADIUS); cc++) {
          const d2 = (cc - mcol) ** 2 + (rr - mrow) ** 2;
          if (d2 < r2) {
            const t = 1 - d2 / r2;
            const idx = rr * cols + cc;
            influence[idx] = Math.min(1, Math.max(influence[idx], t * t));
          }
        }
      }
      prevMX = curMX;
      prevMY = curMY;
    }

    function paint(time: number, animate: boolean) {
      if (animate) {
        paintInfluence();
        for (let i = 0; i < influence.length; i++) influence[i] *= DECAY;
      }

      const tSec = time * 0.001;
      context.clearRect(0, 0, w, h);
      context.font = `${FONT_SIZE}px monospace`;
      context.textBaseline = "top";
      const cx = cols * 0.5;
      const cy = rows * 0.4;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const dx = (col - cx) / cx;
          const dy = (row - cy) / cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          let bestDensity = 0;
          let bestAlpha = 0;
          let bestLit = 0.5;

          for (const layer of LAYERS) {
            const radial = Math.log(dist + 0.05) * layer.scale - tSec * layer.speed;
            const nx = angle * 3.5 + layer.seed;
            const ny = radial + layer.seed * 0.1;
            const n = (fbm(nx, ny, 4) + 1) * 0.5;
            const raw = n * (1 - Math.exp(-dist * 2.5));
            if (raw > layer.threshold) {
              const d = (raw - layer.threshold) / (1 - layer.threshold);
              const shaped = d * d * (3 - 2 * d);
              if (shaped > bestDensity) {
                bestDensity = shaped;
                bestAlpha = layer.alpha;
                const sn = (fbm(nx * 0.5 + 20, ny * 0.5 + 20, 2) + 1) * 0.5;
                bestLit = 0.45 + sn * 0.55;
              }
            }
          }

          const baseDensity = (fbm(angle * 2 + 7, Math.log(dist + 0.1) * 2 - tSec * 0.03 + 7, 3) + 1) * 0.5;
          let finalDensity = Math.max(baseDensity * 0.35, bestDensity);
          const inf = influence[row * cols + col] ?? 0;
          if (inf > 0.001) finalDensity *= 1 - inf * 0.85;

          let r = Math.round(lerp(240, 255, 0.5 + finalDensity * bestLit * 0.5));
          let g = Math.round(lerp(180, 220, 0.5 + finalDensity * bestLit * 0.5));
          let b = Math.round(lerp(210, 245, 0.5 + finalDensity * bestLit * 0.5));
          let alpha = bestDensity > 0.01 ? lerp(0.5, bestAlpha, bestDensity) : 0.3 + baseDensity * 0.3;

          if (inf > 0.001) {
            r = Math.round(lerp(r, 255, inf * 0.45));
            g = Math.round(lerp(g, 165, inf * 0.45));
            b = Math.round(lerp(b, 210, inf * 0.45));
            alpha = Math.min(1, alpha + inf * 0.3);
          }

          r = Math.round(lerp(r, 198, 0.44));
          g = Math.round(lerp(g, 78, 0.44));
          b = Math.round(lerp(b, 148, 0.44));
          alpha = Math.min(1, alpha * 1.22);
          if (alpha < 0.22) alpha = Math.min(0.42, alpha * 1.55);

          context.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          context.fillText(pickChar(finalDensity), col * CHAR_W, row * CHAR_H);
        }
      }
    }

    function stopLoop() {
      if (animId) cancelAnimationFrame(animId);
      animId = 0;
    }

    function draw(time: number) {
      paint(time, true);
      animId = requestAnimationFrame(draw);
    }

    function startLoop() {
      stopLoop();
      animId = requestAnimationFrame(draw);
    }

    function drawStatic() {
      stopLoop();
      paint(performance.now(), false);
    }

    function syncPlayback() {
      if (document.hidden || motion.matches) {
        drawStatic();
        return;
      }
      startLoop();
    }

    function onMouseMove(e: MouseEvent) {
      mouseX.current = e.clientX;
      mouseY.current = e.clientY;
    }

    function onResize() {
      resize();
      syncPlayback();
    }

    resize();
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", syncPlayback);
    motion.addEventListener("change", syncPlayback);
    syncPlayback();

    return () => {
      stopLoop();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", syncPlayback);
      motion.removeEventListener("change", syncPlayback);
    };
  }, []);

  return <canvas ref={canvasRef} className="ascii-field" aria-hidden="true" />;
}
