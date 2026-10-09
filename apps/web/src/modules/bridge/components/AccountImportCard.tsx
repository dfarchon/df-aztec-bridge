import type { ReactNode } from "react";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";

type AccountImportCardProps = {
  session: BridgeSession;
  id?: string;
  highlight?: boolean;
  title?: string;
  hint?: ReactNode;
  onFile: (file: File | null) => void;
  onSelectAccount: (index: number) => void;
};

export function AccountImportCard({
  session,
  id,
  highlight,
  title,
  hint,
  onFile,
  onSelectAccount,
}: AccountImportCardProps) {
  const {
    importDragOver,
    setImportDragOver,
    busy,
    importName,
    importedAccounts,
    importedIndex,
  } = session;

  return (
    <div
      id={id ?? "aztec-account-import"}
      className={`card account-import${highlight ? " recovery-active" : ""}`}
    >
      <strong>{title ?? "Import Aztec account"}</strong>
      <p className="hint">
        {hint ?? (
          <>
            Upload <span className="mono">dfpunk-account-*.json</span> or{" "}
            <span className="mono">.txt</span> backup with{" "}
            <span className="mono">address / secretKey / salt / signingKey</span>. Fills the form
            below (signingKey is required for dfpunk accounts).             Prefer <strong>Wallets</strong> (top right) → Import from DF client → PXE for bridge.
          </>
        )}
      </p>
      <div
        className={`dropzone${importDragOver ? " drag-over" : ""}${busy ? " disabled" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setImportDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setImportDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget === e.target) setImportDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setImportDragOver(false);
          if (busy) return;
          const f = e.dataTransfer.files?.[0] ?? null;
          void onFile(f);
        }}
      >
        <p className="dropzone-title">
          {importDragOver ? "Release to upload" : "Drag & drop JSON or .txt backup"}
        </p>
        <p className="hint">or click to choose a file</p>
        <label className="file-label">
          <span className="sr-only">Choose JSON file</span>
          <input
            type="file"
            accept="application/json,.json,.txt,text/plain"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {importName ? (
        <p className="hint">
          Loaded <span className="mono">{importName}</span>
          {importedAccounts.length > 1 ? ` (${importedAccounts.length} accounts)` : ""}
        </p>
      ) : null}
      {importedAccounts.length > 1 ? (
        <label>
          Account in file
          <select
            value={importedIndex}
            disabled={busy}
            onChange={(e) => {
              const i = Number(e.target.value);
              onSelectAccount(i);
            }}
          >
            {importedAccounts.map((a, i) => (
              <option key={`${a.address}-${i}`} value={i}>
                #{i + 1} {a.address.slice(0, 10)}…{a.address.slice(-6)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>

  );
}
