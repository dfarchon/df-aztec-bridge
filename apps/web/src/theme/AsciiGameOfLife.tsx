import { useEffect, useRef } from "react";
import { CHAR_H, CHAR_W, FONT_SIZE, fbm, lerp } from "./ascii-noise.ts";

type Cells = [number, number][];

const PATTERNS: (Cells | null)[] = [
  [[0, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]],
  [[0, 1], [0, 4], [1, 0], [2, 0], [2, 4], [3, 0], [3, 1], [3, 2], [3, 3]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2]],
  [[0, 1], [1, 3], [2, 0], [2, 1], [2, 4], [2, 5], [2, 6]],
  [[0, 6], [1, 0], [1, 1], [2, 1], [2, 5], [2, 6], [2, 7]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [2, 1], [3, 1], [4, 1]],
  [
    [0, 2], [0, 7], [1, 0], [1, 1], [1, 3], [1, 4], [1, 5], [1, 6], [1, 8], [1, 9],
    [2, 2], [2, 7],
  ],
  [
    [0, 2], [0, 3], [1, 0], [1, 5], [2, 6], [3, 0], [3, 6], [4, 1], [4, 2], [4, 3],
    [4, 4], [4, 5], [4, 6],
  ],
  null,
];

const CHAOS_PATTERNS: Cells[] = [
  [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]],
  [[0, 1], [1, 3], [2, 0], [2, 1], [2, 4], [2, 5], [2, 6]],
  [[0, 6], [1, 0], [1, 1], [2, 1], [2, 5], [2, 6], [2, 7]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [2, 1], [3, 1], [4, 1]],
];

const GOSPER_GUN: Cells = [
  [0, 24], [1, 22], [1, 24], [2, 12], [2, 13], [2, 20], [2, 21], [2, 34], [2, 35],
  [3, 11], [3, 15], [3, 20], [3, 21], [3, 34], [3, 35], [4, 0], [4, 1], [4, 10],
  [4, 16], [4, 20], [4, 21], [5, 0], [5, 1], [5, 10], [5, 14], [5, 16], [5, 17],
  [5, 22], [5, 24], [6, 10], [6, 16], [6, 24], [7, 11], [7, 15], [8, 12], [8, 13],
];

const TIME_SCALE = 0.5;
const BG_CHARS = ".,·:;-=+";
const BIRTH_CHARS = "·+*%";
const GROW_CHARS = "+*%#&";
const MATURE_CHARS = "#@&%*+";
const ELDER_CHARS = "@&#%*";
const FADE_CHARS = "·.:,-";

export function AsciiGameOfLife() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const view = canvas;
    const context = ctx;

    const SIM_INTERVAL = 100 / TIME_SCALE;
    const MAX_AGE = 50;
    const DECAY_FRAMES = 15;
    const SPAWN_DIST = 25;
    const POP_CHECK = 30;
    const MIN_POP = 0.025;
    const EVENT_INTERVAL = 400;
    const RIPPLE_DECAY = 0.93;
    const RIPPLE_R = 8;

    let cols = 0;
    let rows = 0;
    let w = 0;
    let h = 0;
    let animId = 0;
    let cells = new Int16Array(0);
    let next = new Int16Array(0);
    let ripple = new Float32Array(0);
    let lastSimTime = 0;
    let lastSpawnX = -999;
    let lastSpawnY = -999;
    let stepCount = 0;
    let seeded = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      view.width = w * dpr;
      view.height = h * dpr;
      view.style.width = `${w}px`;
      view.style.height = `${h}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const nc = Math.ceil(w / CHAR_W) + 1;
      const nr = Math.ceil(h / CHAR_H) + 1;
      const fresh = new Int16Array(nc * nr);

      if (cells.length) {
        for (let r = 0; r < Math.min(rows, nr); r++) {
          for (let c = 0; c < Math.min(cols, nc); c++) {
            fresh[r * nc + c] = cells[r * cols + c];
          }
        }
      }

      cols = nc;
      rows = nr;
      cells = fresh;
      next = new Int16Array(cols * rows);
      ripple = new Float32Array(cols * rows);
    }

    function place(pat: Cells, cr: number, cc: number) {
      const fh = Math.random() > 0.5;
      const fv = Math.random() > 0.5;
      for (const [dr, dc] of pat) {
        const r = (((cr + (fv ? -dr : dr)) % rows) + rows) % rows;
        const c = (((cc + (fh ? -dc : dc)) % cols) + cols) % cols;
        if (cells[r * cols + c] <= 0) cells[r * cols + c] = 1;
      }
    }

    function randPat(): Cells {
      const p = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
      if (p) return p;
      const out: Cells = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) if (Math.random() > 0.4) out.push([r, c]);
      }
      return out;
    }

    function seed() {
      const n = Math.floor((cols * rows) / 35);
      for (let i = 0; i < n; i++) {
        place(randPat(), Math.floor(Math.random() * rows), Math.floor(Math.random() * cols));
      }
      if (cols > 40 && rows > 12) {
        place(GOSPER_GUN, Math.floor(rows * 0.2), Math.floor(cols * 0.15));
        if (cols > 80) place(GOSPER_GUN, Math.floor(rows * 0.7), Math.floor(cols * 0.65));
      }
      seeded = true;
    }

    function step() {
      stepCount += 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let nb = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              if (cells[((r + dr + rows) % rows) * cols + ((c + dc + cols) % cols)] > 0) nb += 1;
            }
          }
          const idx = r * cols + c;
          const s = cells[idx];
          if (s > 0) next[idx] = nb === 2 || nb === 3 ? (s < MAX_AGE ? s + 1 : MAX_AGE) : -1;
          else if (nb === 3) next[idx] = 1;
          else if (s < 0) next[idx] = s - 1 < -DECAY_FRAMES ? 0 : s - 1;
          else next[idx] = 0;
        }
      }
      const tmp = cells;
      cells = next;
      next = tmp;

      if (stepCount % POP_CHECK === 0) {
        let alive = 0;
        for (let i = 0; i < cells.length; i++) if (cells[i] > 0) alive += 1;
        if (alive / (cols * rows) < MIN_POP) {
          const spawns = 3 + Math.floor(Math.random() * 4);
          for (let i = 0; i < spawns; i++) {
            place(randPat(), Math.floor(Math.random() * rows), Math.floor(Math.random() * cols));
          }
        }
      }

      if (stepCount % EVENT_INTERVAL === 0) {
        place(
          CHAOS_PATTERNS[Math.floor(Math.random() * CHAOS_PATTERNS.length)],
          Math.floor(Math.random() * rows),
          Math.floor(Math.random() * cols),
        );
        if (Math.random() < 0.15 && cols > 40 && rows > 12) {
          place(GOSPER_GUN, Math.floor(Math.random() * (rows - 10)), Math.floor(Math.random() * (cols - 38)));
        }
      }
    }

    function spawnAtMouse() {
      if (motion.matches) return;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const dx = mx - lastSpawnX;
      const dy = my - lastSpawnY;
      if (dx * dx + dy * dy < SPAWN_DIST * SPAWN_DIST) return;
      lastSpawnX = mx;
      lastSpawnY = my;
      const mc = Math.round(mx / CHAR_W);
      const mr = Math.round(my / CHAR_H);
      place(randPat(), mr, mc);
      const r2 = RIPPLE_R * RIPPLE_R;
      for (let rr = Math.max(0, mr - RIPPLE_R); rr <= Math.min(rows - 1, mr + RIPPLE_R); rr++) {
        for (let cc = Math.max(0, mc - RIPPLE_R); cc <= Math.min(cols - 1, mc + RIPPLE_R); cc++) {
          const d2 = (rr - mr) ** 2 + (cc - mc) ** 2;
          if (d2 < r2) {
            const t = 1 - d2 / r2;
            const idx = rr * cols + cc;
            ripple[idx] = Math.min(1, Math.max(ripple[idx], t * t));
          }
        }
      }
    }

    function paint(time: number, simulate: boolean) {
      if (simulate && time - lastSimTime > SIM_INTERVAL) {
        spawnAtMouse();
        step();
        lastSimTime = time;
      }
      if (simulate) {
        for (let i = 0; i < ripple.length; i++) ripple[i] *= RIPPLE_DECAY;
      }

      const tSec = time * 0.001 * TIME_SCALE;
      context.clearRect(0, 0, w, h);
      context.font = `${FONT_SIZE}px monospace`;
      context.textBaseline = "top";

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          const s = cells[idx];
          const rip = ripple[idx];
          const cellHash = row * 0.37 + col * 0.23;
          let ch: string;
          let r: number;
          let g: number;
          let b: number;
          let a: number;

          if (s > 0) {
            const life = Math.min(s / MAX_AGE, 1);
            if (s <= 3) {
              ch = BIRTH_CHARS[Math.floor(tSec * 1.5 + cellHash) % BIRTH_CHARS.length];
              a = 0.7 + 0.15 * Math.sin(tSec * 4 + cellHash * 6);
            } else if (s <= 12) {
              const t = (s - 3) / 9;
              ch = GROW_CHARS[Math.floor(tSec * 0.8 + cellHash + t * 3) % GROW_CHARS.length];
              a = 0.55 + t * 0.2;
            } else if (s <= 35) {
              const t = (s - 12) / 23;
              ch = MATURE_CHARS[Math.floor(tSec * 0.5 + cellHash + t * 2) % MATURE_CHARS.length];
              a = 0.65 + t * 0.18;
            } else {
              ch = ELDER_CHARS[Math.floor(tSec * 0.3 + cellHash) % ELDER_CHARS.length];
              a = 0.78 + Math.sin(tSec * 1.2 + row * 0.4 + col * 0.3) * 0.08;
            }
            r = Math.round(lerp(220, 250, life));
            g = Math.round(lerp(170, 210, life));
            b = Math.round(lerp(195, 235, life));
          } else if (s < 0) {
            const t = -s / DECAY_FRAMES;
            ch = FADE_CHARS[Math.floor(tSec + cellHash) % FADE_CHARS.length];
            r = Math.round(lerp(215, 185, t));
            g = Math.round(lerp(160, 130, t));
            b = Math.round(lerp(185, 160, t));
            a = Math.max(0, 0.5 * (1 - t));
          } else {
            const n = (fbm(col * 0.05 + tSec * 0.015, row * 0.05, 3) + 1) * 0.5;
            ch = BG_CHARS[Math.floor(tSec * 0.8 + cellHash) % BG_CHARS.length];
            r = Math.round(lerp(210, 240, n));
            g = Math.round(lerp(155, 190, n));
            b = Math.round(lerp(180, 215, n));
            a = 0.4 + n * 0.45;
            if (rip > 0.01) {
              a = Math.min(0.8, a + rip * 0.3);
              r = Math.round(lerp(r, 250, rip * 0.5));
              g = Math.round(lerp(g, 200, rip * 0.5));
              b = Math.round(lerp(b, 225, rip * 0.5));
            }
          }

          context.fillStyle = `rgba(${r},${g},${b},${a})`;
          context.fillText(ch, col * CHAR_W, row * CHAR_H);
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
      lastSimTime = performance.now();
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
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    }

    function onResize() {
      resize();
      if (!seeded) seed();
      syncPlayback();
    }

    resize();
    seed();
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
