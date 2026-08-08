import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DEV_ALIAS_HOST,
  DEV_BRANCH_HOST,
  markDevGateUnlocked,
  verifyDevGatePassword,
} from "../../lib/dev-gate.ts";
import {
  SUPPORTED_AZTEC_CLIENT_VERSION,
  verifyNetworkAgainstOfficial,
  type NetworkVerifyResult,
} from "../../lib/network-verify.ts";
import { DEFAULT_NETWORK_ID, getNetwork } from "../../config/networks.ts";

export function DevGatePage(props: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<NetworkVerifyResult | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const runVersionGuard = useCallback(async () => {
    setVerifyBusy(true);
    setError(null);
    try {
      const network = getNetwork(DEFAULT_NETWORK_ID);
      setVerify(await verifyNetworkAgainstOfficial(network));
    } catch (e: unknown) {
      setVerify(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifyBusy(false);
    }
  }, []);

  useEffect(() => {
    void runVersionGuard();
  }, [runVersionGuard]);

  const versionOk =
    !!verify &&
    verify.errors.length === 0 &&
    verify.versionMatch === true &&
    verify.addressMatch !== false;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!versionOk) {
        setError("Version guard must pass before unlock.");
        return;
      }
      const result = await verifyDevGatePassword(password);
      if (!result.ok) {
        setError(
          result.reason === "misconfigured"
            ? "Dev gate misconfigured — set a unique VITE_DEV_GATE_PASSWORD_HASH (SHA-256 hex) in Netlify; the published example hash is blocked. Also enable Netlify visitor password."
            : result.reason === "rate_limited"
              ? "Too many attempts — wait a minute and try again."
              : "Invalid client password.",
        );
        return;
      }
      markDevGateUnlocked();
      props.onUnlocked();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dev-gate-page">
      <div className="dev-gate-card">
        <p className="label">dev · aztec-dfarchon-kit</p>
        <h1>Client access</h1>
        <p className="dev-gate-lead">
          Private preview host (<span className="mono">{DEV_ALIAS_HOST}</span> /{" "}
          <span className="mono">{DEV_BRANCH_HOST}</span>). Enter the client password after
          version-guard checks pass.
        </p>

        <section className="dev-gate-version" aria-live="polite">
          <div className="dev-gate-version-head">
            <strong>Version guard</strong>
            <button
              type="button"
              className="ghost"
              disabled={verifyBusy}
              onClick={() => void runVersionGuard()}
            >
              {verifyBusy ? "Checking…" : "Re-check"}
            </button>
          </div>
          {!verify ? (
            <p className="hint">Checking client {SUPPORTED_AZTEC_CLIENT_VERSION} vs Aztec node…</p>
          ) : (
            <>
              <p className={versionOk ? "hint storage-status-ok" : "error"}>
                {versionOk
                  ? `OK — client ${verify.clientVersion} matches node ${verify.node?.nodeVersion ?? "—"}; Fee Juice / portal consistent.`
                  : `Blocked — ${verify.errors[0] ?? `client ${verify.clientVersion} vs node ${verify.node?.nodeVersion ?? "unknown"}`}`}
              </p>
              <p className="hint mono">
                tip {verify.primaryBlock ?? "—"}
                {verify.blockDelta !== null ? ` · Δ${verify.blockDelta}` : ""}
                {" · "}
                RPC {verify.officialRpcHost ? "allowlisted" : "custom"}
              </p>
            </>
          )}
        </section>

        <form className="dev-gate-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Client password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Preview password"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="primary" disabled={busy || !password.trim() || !versionOk}>
            {busy ? "Checking…" : "Unlock preview"}
          </button>
        </form>
        <p className="hint">
          Session unlock lasts for this browser tab. Netlify visitor password is required for
          host-level access control — this client gate alone is not sufficient.
        </p>
      </div>
    </main>
  );
}
