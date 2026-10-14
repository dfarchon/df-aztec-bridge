/**
 * Auto-lock the vault after idle / tab hidden to shrink unlocked-session XSS window.
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
let started = false;

function clearIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function clearHidden() {
  if (hiddenTimer) clearTimeout(hiddenTimer);
  hiddenTimer = null;
}

function lockIfUnlocked(reason: VaultAutoLockReason) {
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
  if (!isVaultUnlocked()) return;
  idleTimer = setTimeout(() => lockIfUnlocked("idle"), IDLE_MS);
}

function onVisibility() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    clearHidden();
    if (!isVaultUnlocked()) return;
    hiddenTimer = setTimeout(() => lockIfUnlocked("tab-hidden"), HIDDEN_MS);
  } else {
    clearHidden();
    bumpIdle();
  }
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/** Call once from VaultProvider. Safe to call multiple times. */
export function startVaultIdleLock(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;

  const onActivity = () => bumpIdle();
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
