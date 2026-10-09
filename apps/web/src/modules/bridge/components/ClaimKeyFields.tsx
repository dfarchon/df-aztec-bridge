import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import { BROWSER_CLAIM } from "../config.ts";

export function ClaimKeyFields({ session }: { session: BridgeSession }) {
  const {
    dfPxeAccount,
    secretsVisible,
    requestUnlock,
    l2Secret,
    setL2Secret,
    showL2Secret,
    setShowL2Secret,
    l2Salt,
    setL2Salt,
    l2SigningKey,
    setL2SigningKey,
  } = session;

    if (dfPxeAccount && !secretsVisible) {
      return (
        <div className="card claim-opts">
          <p className="hint">
            PXE wallet secrets are hidden until the vault unlocks (password + signingKey).
          </p>
          <button type="button" className="primary" onClick={requestUnlock}>
            Unlock vault
          </button>
        </div>
      );
    }
    return (
    <div className="card claim-opts">
      <p className="hint">
        {BROWSER_CLAIM
          ? "Account keys are used only in memory for the browser claim and are not persisted."
          : "Secret is only used server-side for wait + claim. Prefer CLI claim if you do not want to paste it into the browser."}
      </p>
      <label>
        L2 secret
        <div className="secret-field">
          <input
            value={l2Secret}
            onChange={(e) => setL2Secret(e.target.value)}
            placeholder="0x…"
            type={showL2Secret ? "text" : "password"}
            autoComplete="off"
          />
          <button
            type="button"
            className="icon-btn utility-control secret-toggle"
            disabled={!l2Secret}
            aria-label={showL2Secret ? "Hide L2 secret" : "Show L2 secret"}
            title={showL2Secret ? "Hide" : "Show"}
            onClick={() => setShowL2Secret((v) => !v)}
          >
            {showL2Secret ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 6a9.77 9.77 0 0 1 8.94 5.5 9.77 9.77 0 0 1-17.88 0A9.77 9.77 0 0 1 12 6m0-2C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
                />
                <path
                  fill="currentColor"
                  d="M3.27 2 2 3.27 5.11 6.4A12.4 12.4 0 0 0 1 11.5C2.73 15.89 7 19 12 19c1.85 0 3.58-.45 5.12-1.23L19.73 21 21 19.73 3.27 2zM12 17c-3.53 0-6.43-2.07-8-5.5a9.9 9.9 0 0 1 2.55-3.36l1.58 1.58A2.5 2.5 0 0 0 12 14.5c.4 0 .78-.1 1.12-.26l1.58 1.58A8.2 8.2 0 0 1 12 17z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 4C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 12.5A2.5 2.5 0 1 1 12 9a2.5 2.5 0 0 1 0 5.5zM12 7c-2.48 0-4.5 2.02-4.5 4.5S9.52 16 12 16s4.5-2.02 4.5-4.5S14.48 7 12 7z"
                />
              </svg>
            )}
          </button>
        </div>
      </label>
      <label>
        Salt (optional, default 0)
        <input
          value={l2Salt}
          onChange={(e) => setL2Salt(e.target.value)}
          placeholder="0x0… or leave empty"
          autoComplete="off"
        />
      </label>
      <label>
        Signing key (required for DF Punk accounts)
        <input
          value={l2SigningKey}
          onChange={(e) => setL2SigningKey(e.target.value)}
          placeholder="0x… from dfpunk-account JSON"
          type={showL2Secret ? "text" : "password"}
          autoComplete="off"
        />
      </label>
    </div>
    );
}
