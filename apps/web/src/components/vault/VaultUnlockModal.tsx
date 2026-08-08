import { useEffect, useId, useState } from "react";
import {
  currentPasskeyRpId,
  isWebAuthnAvailable,
  prefersPlatformAuthenticator,
} from "../../lib/vault-passkey.ts";

export type VaultModalMode = "setup" | "unlock";

export function VaultUnlockModal(props: {
  open: boolean;
  mode: VaultModalMode;
  aztecAddress: string | null;
  busy?: boolean;
  error?: string | null;
  /** When unlocking a vault that already has a passkey registered. */
  passkeyRequired?: boolean;
  /** Show recovery actions after a recoverable passkey failure. */
  passkeyRecovery?: boolean;
  onSubmit: (password: string, opts: { registerPasskey: boolean }) => void | Promise<void>;
  /** Password already verified path: register a new passkey for this host. */
  onReplacePasskey?: (password: string) => void | Promise<void>;
  /** Wipe vault after password; user re-imports DF Punk JSON. */
  onRecoverViaJson?: (password: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const {
    open,
    mode,
    aztecAddress,
    busy,
    error,
    passkeyRequired,
    passkeyRecovery,
    onSubmit,
    onReplacePasskey,
    onRecoverViaJson,
    onCancel,
  } = props;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [webAuthnOk, setWebAuthnOk] = useState(false);
  const [platformOk, setPlatformOk] = useState(false);
  const [registerPasskey, setRegisterPasskey] = useState(true);
  const titleId = useId();
  const host = currentPasskeyRpId() || "this site";

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirm("");
      return;
    }
    const available = isWebAuthnAvailable();
    setWebAuthnOk(available);
    setRegisterPasskey(available);
    if (available) {
      void prefersPlatformAuthenticator().then(setPlatformOk);
    } else {
      setPlatformOk(false);
    }
  }, [open]);

  if (!open) return null;

  const mismatch = mode === "setup" && confirm.length > 0 && password !== confirm;
  const tooShort = mode === "setup" && password.length > 0 && password.length < 8;
  const canSubmit =
    !busy &&
    password.length >= (mode === "unlock" ? 1 : 8) &&
    (mode === "unlock" || (password === confirm && !tooShort));
  const canRecover = mode === "unlock" && !!passkeyRecovery && password.length >= 1 && !busy;

  const setupPasskeyHint = platformOk
    ? "Uses Face ID, fingerprint, or Windows Hello on this device."
    : "Uses this device or a phone (hybrid) / security key when prompted.";

  return (
    <div className="modal-backdrop vault-modal-backdrop" role="presentation">
      <div
        className="modal vault-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <h2 id={titleId}>
            {mode === "setup" ? "Set vault password + passkey" : "Unlock vault"}
          </h2>
          {onCancel ? (
            <button type="button" className="icon-btn ghost" onClick={onCancel} disabled={busy}>
              ×
            </button>
          ) : null}
        </div>
        <p className="muted small">
          {mode === "setup"
            ? "Admin password encrypts this DF Punk vault. A device passkey adds a second factor (biometrics / phone)."
            : passkeyRequired
              ? "Enter your password, then approve the device passkey (Face ID / fingerprint / phone)."
              : "Enter your vault password. PXE wallet info is restored from IndexedDB."}
        </p>
        {aztecAddress ? (
          <p className="mono small vault-modal-addr">{aztecAddress}</p>
        ) : null}
        {mode === "unlock" && passkeyRequired ? (
          <p className="hint mono small">Site host (passkey rpId): {host}</p>
        ) : null}
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "setup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {mode === "setup" ? (
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
        ) : null}
        {mode === "setup" && webAuthnOk ? (
          <label className="field vault-passkey-opt">
            <span className="vault-passkey-opt-row">
              <input
                type="checkbox"
                checked={registerPasskey}
                onChange={(e) => setRegisterPasskey(e.target.checked)}
                disabled={busy}
              />
              <strong>Register passkey on this device / phone</strong>
            </span>
            <span className="hint">{setupPasskeyHint}</span>
            {!registerPasskey ? (
              <span className="error small">
                Skipping passkey weakens vault security (password-only).
              </span>
            ) : null}
          </label>
        ) : null}
        {mode === "setup" && !webAuthnOk ? (
          <p className="hint">
            Passkeys need HTTPS (or localhost) and a compatible browser. Continuing with
            password only.
          </p>
        ) : null}
        {mode === "unlock" && passkeyRequired && !passkeyRecovery ? (
          <p className="hint vault-passkey-unlock-hint">
            After password, your device will ask for biometric / PIN / phone confirmation.
          </p>
        ) : null}
        {tooShort ? <p className="error small">Password must be at least 8 characters.</p> : null}
        {mismatch ? <p className="error small">Passwords do not match.</p> : null}
        {error ? <p className="error small">{error}</p> : null}
        {passkeyRecovery ? (
          <div className="vault-passkey-recovery">
            <p className="hint">
              Recovery for this host (<span className="mono">{host}</span>): replace the passkey
              after password check, or wipe this vault and re-import DF Punk JSON.
            </p>
            <div className="modal-actions vault-passkey-recovery-actions">
              {onReplacePasskey ? (
                <button
                  type="button"
                  className="primary"
                  disabled={!canRecover || !webAuthnOk}
                  onClick={() => void onReplacePasskey(password)}
                >
                  {busy ? "…" : "Replace passkey for this host"}
                </button>
              ) : null}
              {onRecoverViaJson ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={!canRecover}
                  onClick={() => void onRecoverViaJson(password)}
                >
                  {busy ? "…" : "Wipe vault → re-import JSON"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="modal-actions">
          {onCancel ? (
            <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={!canSubmit}
            onClick={() =>
              void onSubmit(password, {
                registerPasskey: mode === "setup" ? registerPasskey && webAuthnOk : false,
              })
            }
          >
            {busy
              ? "…"
              : mode === "setup"
                ? registerPasskey && webAuthnOk
                  ? "Create vault + passkey"
                  : "Create vault"
                : passkeyRequired
                  ? "Unlock with password + passkey"
                  : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
