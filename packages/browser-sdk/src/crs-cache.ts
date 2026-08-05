/**
 * Normalizes the CRS that bb.js caches in IndexedDB.
 *
 * bb.js stores the uncompressed CRS under a size-agnostic key and reuses any entry at
 * least as long as the point count it currently wants, without trimming it. An entry
 * written for a larger SRS (an older bb.js default, or an iOS/desktop size switch) then
 * makes the WASM compute the wrong bytes-per-point and reject the buffer with
 * "SrsInitSrs: invalid points_buf size. Expected 32 or 64 bytes per point, got 128".
 *
 * A CRS prefix is itself a valid smaller CRS — bb.js downloads one via a `bytes=0-…`
 * range request — so trimming is safe and keeps the cache warm.
 */
import { get, set } from "idb-keyval";

// Mirrors bb.js: DEFAULT_BB_CRS_SIZE / IOS_BB_CRS_SIZE and the fixed grumpkin size.
const DEFAULT_SRS_POINTS = 2 ** 19;
const IOS_SRS_POINTS = 2 ** 18;
const GRUMPKIN_SRS_POINTS = 2 ** 16;
const UNCOMPRESSED_POINT_BYTES = 64;

function srsPoints(): number {
  const ua = globalThis.navigator?.userAgent ?? "";
  return /iPad|iPhone/.test(ua) ? IOS_SRS_POINTS : DEFAULT_SRS_POINTS;
}

async function trimEntry(key: string, expectedBytes: number): Promise<boolean> {
  const cached = await get<Uint8Array>(key);
  if (!cached || cached.length <= expectedBytes) return false;
  await set(key, cached.slice(0, expectedBytes));
  return true;
}

/** Safe to call on every warmup — a correctly sized cache is left untouched. */
export async function trimOversizedCrsCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const trimmed = await Promise.all([
      trimEntry("g1Data", srsPoints() * UNCOMPRESSED_POINT_BYTES),
      trimEntry("grumpkinG1DataV2", GRUMPKIN_SRS_POINTS * UNCOMPRESSED_POINT_BYTES),
    ]);
    if (trimmed.some(Boolean)) {
      console.info("[claim] Trimmed oversized cached CRS to the current SRS size");
    }
  } catch (error) {
    console.warn("[claim] Could not normalize cached CRS", error);
  }
}
