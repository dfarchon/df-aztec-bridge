/**
 * Auto-lock the vault after idle / tab hidden to shrink unlocked-session XSS window.
 * Timers pause while a bridge/claim run is in progress so mid-proof unlocks are not wiped.
 */

import {
  isVaultUnlocked,
  lockVault,
  subscribeVault,
  type VaultAutoLockReason,
} from "./vault.ts";

export const VAULT_TIMEOUT_NOTICE =
  "This session timed out and locked. Enter your password to open it again.";

const IDLE_MS = 15 * 60 * 1000;
const HIDDEN_MS = 5 * 60 * 1000;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
let warningTimer: ReturnType<typeof setTimeout> | null = null;
let idleDeadline: number | null = null;
let hiddenDeadline: number | null = null;
let warningVisible = false;
const warningListeners = new Set<(deadline: number | null) => void>();
const resetListeners = new Set<() => void>();
function notifyWarning(deadline: number | null) {
  warningVisible = deadline !== null;
  for (const listener of warningListeners) listener(deadline);
}
export function subscribeVaultLockWarning(listener: (deadline: number | null) => void): () => void {
  warningListeners.add(listener);
  return () => { warningListeners.delete(listener); };
}
export function subscribeVaultLockReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => { resetListeners.delete(listener); };
}
let started = false;
/** When true, idle / tab-hidden timers do not fire (active bridge or claim). */
let paused = false;

function clearIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  if (warningTimer) clearTimeout(warningTimer);
  idleTimer = null;
  warningTimer = null;
  idleDeadline = null;
  notifyWarning(null);
}

function clearHidden() {
  if (hiddenTimer) clearTimeout(hiddenTimer);
  hiddenTimer = null;
  hiddenDeadline = null;
}

function lockIfUnlocked(reason: VaultAutoLockReason) {
  if (paused) return;
  if (!isVaultUnlocked()) return;
  lockVault(reason);
  try {
    console.info(`[vault] auto-locked (${reason})`);
  } catch {
    /* ignore */
  }
}

function bumpIdle() {
  clearIdle();
  if (paused || !isVaultUnlocked()) return;
  const deadline = Date.now() + IDLE_MS;
  idleDeadline = deadline;
  warningTimer = setTimeout(() => {
    if (!paused && isVaultUnlocked() && document.visibilityState === "visible") notifyWarning(deadline);
  }, IDLE_MS - 60_000);
  idleTimer = setTimeout(() => lockIfUnlocked("idle"), IDLE_MS);
}

function onVisibility() {
  if (typeof document === "undefined") return;
  if (!paused && isVaultUnlocked() && ((hiddenDeadline !== null && Date.now() >= hiddenDeadline) || (idleDeadline !== null && Date.now() >= idleDeadline))) {
    lockIfUnlocked(hiddenDeadline !== null && Date.now() >= hiddenDeadline ? "tab-hidden" : "idle");
    return;
  }
  if (document.visibilityState === "hidden") {
    notifyWarning(null);
    clearHidden();
    if (paused || !isVaultUnlocked()) return;
    hiddenDeadline = Date.now() + HIDDEN_MS;
    hiddenTimer = setTimeout(() => lockIfUnlocked("tab-hidden"), HIDDEN_MS);
  } else {
    clearHidden();
    bumpIdle();
  }
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Pause idle / tab-hidden auto-lock while bridge or claim progress is running.
 * Safe to call with the same value repeatedly.
 */
export function setVaultIdleLockPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  if (paused) {
    clearIdle();
    clearHidden();
    return;
  }
  if (isVaultUnlocked()) {
    bumpIdle();
    if (typeof document !== "undefined" && document.visibilityState === "hidden") onVisibility();
  }
}

export function isVaultIdleLockPaused(): boolean {
  return paused;
}

/** Call once from VaultProvider. Safe to call multiple times. */
export function startVaultIdleLock(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;

  const onActivity = () => {
    if (idleDeadline !== null && Date.now() >= idleDeadline) {
      lockIfUnlocked("idle");
      return;
    }
    const shouldNotify = warningVisible && !paused && isVaultUnlocked();
    bumpIdle();
    if (shouldNotify) for (const listener of resetListeners) listener();
  };
  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, onActivity, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisibility);

  const unsub = subscribeVault(() => {
    if (isVaultUnlocked()) bumpIdle();
    else {
      clearIdle();
      clearHidden();
    }
  });

  if (isVaultUnlocked()) bumpIdle();

  return () => {
    started = false;
    paused = false;
    unsub();
    clearIdle();
    clearHidden();
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, onActivity);
    }
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Test helpers */
export const VAULT_IDLE_MS = IDLE_MS;
export const VAULT_HIDDEN_MS = HIDDEN_MS;
