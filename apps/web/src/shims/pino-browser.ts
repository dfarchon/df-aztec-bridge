/**
 * @aztec/foundation imports `{ pino, symbols } from "pino"`.
 * pino's browser build is CJS (`module.exports`) and does not expose ESM named exports,
 * which breaks Vite's native ESM loader in the browser.
 */
// Unique id — avoids Vite aliasing `pino` → this shim and then `/browser.js`.
import pinoBrowser from "pino-browser-entry";

type PinoFn = (...args: unknown[]) => unknown;

const mod = pinoBrowser as PinoFn & {
  default?: PinoFn;
  pino?: PinoFn;
  symbols?: { streamSym?: symbol };
};

export const pino = mod.default ?? mod.pino ?? (mod as PinoFn);

// browser.js does not attach symbols; Node-only stream helpers need a stable streamSym.
export const symbols = mod.symbols ?? { streamSym: Symbol("pino.stream") };

export default pino;
