import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ unlocked: true, changed: () => {}, lock: vi.fn() }));
vi.mock("./vault.ts", () => ({
  isVaultUnlocked: () => vault.unlocked,
  lockVault: (reason: string) => { vault.unlocked = false; vault.lock(reason); vault.changed(); },
  subscribeVault: (listener: () => void) => { vault.changed = listener; return () => { vault.changed = () => {}; }; },
}));
import { setVaultIdleLockPaused, startVaultIdleLock, subscribeVaultLockReset, subscribeVaultLockWarning } from "./vault-idle-lock.ts";

describe("vault idle lock warning", () => {
  let cleanup: () => void;
  let doc: EventTarget & { visibilityState: string };
  let win: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    vault.unlocked = true;
    vault.lock.mockClear();
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    cleanup = startVaultIdleLock();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("warns one minute before locking and resets only on activity", () => {
    const warning = vi.fn();
    const reset = vi.fn();
    const offWarning = subscribeVaultLockWarning(warning);
    const offReset = subscribeVaultLockReset(reset);
    vi.advanceTimersByTime(14 * 60_000);
    expect(warning).toHaveBeenLastCalledWith(Date.now() + 60_000);
    win.dispatchEvent(new Event("pointerdown"));
    expect(reset).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(14 * 60_000 + 59_000);
    expect(vault.lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(vault.lock).toHaveBeenCalledWith("idle");
    offWarning(); offReset();
  });

  it("hides the warning on backgrounding and retains the earlier idle deadline", () => {
    const warning = vi.fn();
    const off = subscribeVaultLockWarning(warning);
    vi.advanceTimersByTime(14 * 60_000);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(warning).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(60_000);
    expect(vault.lock).toHaveBeenCalledWith("idle");
    off();
  });

  it("locks after five minutes in the background when the idle deadline is later", () => {
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(5 * 60_000);
    expect(vault.lock).toHaveBeenCalledWith("tab-hidden");
  });

  it("pauses while a flow runs and starts the hidden timeout on resume", () => {
    setVaultIdleLockPaused(true);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(20 * 60_000);
    expect(vault.lock).not.toHaveBeenCalled();
    setVaultIdleLockPaused(false);
    vi.advanceTimersByTime(5 * 60_000);
    expect(vault.lock).toHaveBeenCalledWith("tab-hidden");
  });
});
