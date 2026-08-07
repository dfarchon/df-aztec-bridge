import { useCallback, useEffect, useState } from "react";
import { useVault } from "../../providers/VaultProvider.tsx";
import {
  downloadJsonFile,
  isVaultUnlocked,
  vaultExportAllJson,
  vaultListDocs,
  vaultGetJson,
} from "../../lib/vault.ts";

export function VaultPage() {
  const { unlocked, pxeAccount, ensureUnlocked, lock, requestUnlock, secretsVisible } =
    useVault();
  const [docIds, setDocIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isVaultUnlocked()) {
      setDocIds([]);
      setPreview("");
      return;
    }
    try {
      const ids = await vaultListDocs();
      setDocIds(ids.sort());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, unlocked]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selected || !isVaultUnlocked()) {
        setPreview("");
        return;
      }
      try {
        const data = await vaultGetJson(selected);
        if (!cancelled) setPreview(JSON.stringify(data, null, 2));
      } catch (e) {
        if (!cancelled) setPreview(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, unlocked]);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await ensureUnlocked("vault-page");
      if (!ok) return;
      const all = await vaultExportAllJson();
      const addr = pxeAccount?.address?.slice(0, 10) ?? "vault";
      downloadJsonFile(`df-bridge-vault-${addr}-${Date.now()}.json`, all);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel vault-page">
      <div className="panel-head">
        <h2>Vault</h2>
        <p className="muted small">
          Password-locked IndexedDB (JSON only). Unlock with password + PXE signingKey.
        </p>
      </div>

      {!pxeAccount ? (
        <p className="muted small">Connect DF Punk PXE first to bind and unlock the vault.</p>
      ) : !unlocked ? (
        <div className="row gap">
          <button type="button" className="primary" onClick={requestUnlock}>
            Unlock vault
          </button>
          <p className="muted small">
            Secrets stay hidden until unlock validates password + signingKey.
          </p>
        </div>
      ) : (
        <div className="row gap">
          <button type="button" className="ghost" onClick={() => lock()}>
            Lock
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void onExport()}>
            Export JSON
          </button>
        </div>
      )}

      {error ? <p className="error small">{error}</p> : null}

      {secretsVisible ? (
        <div className="vault-browser">
          <ul className="vault-doc-list">
            {docIds.length === 0 ? (
              <li className="muted small">No documents yet.</li>
            ) : (
              docIds.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className={`ghost mono${selected === id ? " is-active" : ""}`}
                    onClick={() => setSelected(id)}
                  >
                    {id}
                  </button>
                </li>
              ))
            )}
          </ul>
          <pre className="vault-json-preview mono small">{preview || "Select a document."}</pre>
        </div>
      ) : (
        <p className="muted small vault-hidden-note">
          Vault contents are hidden while locked or without a connected PXE wallet.
        </p>
      )}
    </section>
  );
}
