import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { phaseLabel, shortHash } from "../../../lib/claim-recovery.ts";
import { formatFjAmount } from "../../../lib/bridge-amount.ts";
import { downloadClaimCredentials } from "../../../lib/claim-credentials-store.ts";
import { getStoredAztecWallet } from "../../../lib/aztec-wallet-store.ts";
import { TxAnalysisLinks } from "../../../components/ui/TxAnalysisLinks.tsx";
import { ProgressPanel } from "../../../components/ui/ProgressPanel.tsx";
import { normalizeL1TxHash, type BridgeSessionEntry } from "../../../lib/bridge-session.ts";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";

export function RecoverRoute({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
  const {
    networkId,
    networkMeta,
    setRecipient,
    setL2Secret,
    setL2Salt,
    setL2SigningKey,
    busy,
    error,
    credentialsImportError,
    credentialsImportNotice,
    recoverySessions,
    selectedRecoveryHash,
    setSelectedRecoveryHash,
    storageReady,
    storageError,
    selectedSession,
    progress,
    setProgress,
    setBridgePhase,
    bridgePhase,
  } = session;
  const {
    selectRecoverySession,
    onClaimCredentialsFile,
    retryResumeL1,
    waitForSessionL2,
    onResumeClaim,
    claimAfterBridge,
    onRemoveSession,
    recoveryAccountReady,
  } = flows;

  const [removeOpen, setRemoveOpen] = useState(false);
  const [accountMissing, setAccountMissing] = useState(false);
  const claimFileRef = useRef<HTMLInputElement>(null);

  const selectedKey = selectedRecoveryHash ? normalizeL1TxHash(selectedRecoveryHash) : null;
  const showDetail =
    !!selectedSession &&
    !!selectedKey &&
    normalizeL1TxHash(selectedSession.l1TxHash) === selectedKey;
  const recoverProgress =
    !!progress &&
    (progress.track === "claim" ||
      progress.track === "resume-l1" ||
      progress.track === "wait-l2");

  const pane = recoverProgress ? "progress" : showDetail ? "detail" : "list";

  const pickSession = (entry: BridgeSessionEntry) => {
    setRemoveOpen(false);
    void selectRecoverySession(entry);
  };

  const pickClaimFile = (file: File | null) => {
    void onClaimCredentialsFile(file);
  };

  const backToList = () => {
    setRemoveOpen(false);
    setSelectedRecoveryHash(null);
  };

  useEffect(() => {
    if (!showDetail || !selectedSession) return;
    const needsAccount =
      selectedSession.phase === "ready-to-claim" ||
      selectedSession.phase === "claiming" ||
      selectedSession.phase === "failed";
    if (!needsAccount) {
      setAccountMissing(false);
      return;
    }
    const recipient = selectedSession.credentials?.recipient ?? selectedSession.recipient;
    let cancelled = false;
    setAccountMissing(false);
    void (async () => {
      const account = await getStoredAztecWallet(recipient);
      if (cancelled) return;
      if (!account) {
        setAccountMissing(true);
        return;
      }
      setRecipient(account.address);
      setL2Secret(account.secretKey);
      setL2Salt(account.salt);
      setL2SigningKey(account.signingKey ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [
    showDetail,
    selectedSession,
    setRecipient,
    setL2Secret,
    setL2Salt,
    setL2SigningKey,
  ]);

  return (
    <div className="recovery-route" aria-label="Recover">
      <div className={`bridge-layout recover-layout${pane === "list" ? " recovery-list-card" : ""}`}>
      <section className="bridge-step" id="recovery-session-guide">
        {pane === "progress" && progress ? (
          <ProgressPanel
            embedded
            progress={progress}
            detail={bridgePhase}
            aztecNodeUrl={networkMeta?.aztecNodeUrl}
            networkId={networkId}
            onDismiss={() => {
              setProgress(null);
              setBridgePhase(null);
              if (progress.runState === "succeeded") backToList();
            }}
            onRetry={() => {
              if (progress.track === "claim" && progress.combinedFlow) {
                void claimAfterBridge();
                return;
              }
              if (!selectedSession) return;
              if (progress.track === "claim") void onResumeClaim(selectedSession);
              else if (progress.track === "resume-l1") void retryResumeL1(selectedSession);
              else if (progress.track === "wait-l2") void waitForSessionL2(selectedSession);
            }}
          />
        ) : null}

        {pane === "detail" && selectedSession ? (
          <DetailStep
            networkId={networkId}
            l1ExplorerUrl={networkMeta?.l1ExplorerUrl}
            aztecExplorerUrl={networkMeta?.aztecExplorerUrl}
            selectedSession={selectedSession}
            recoveryAccountReady={recoveryAccountReady}
            accountMissing={accountMissing}
            busy={busy}
            error={error}
            onRetry={() => void retryResumeL1(selectedSession)}
            onWait={() => void waitForSessionL2(selectedSession)}
            onResume={() => void onResumeClaim(selectedSession)}
            onDownload={() => {
              if (!selectedSession.credentials) return;
              downloadClaimCredentials(
                selectedSession.credentials.recipient,
                selectedSession.credentials,
                { l1TxHash: selectedSession.l1TxHash, networkId },
              );
            }}
            onRemove={() => setRemoveOpen(true)}
            onBackToList={backToList}
          />
        ) : null}

        {pane === "list" ? (
          <>
            <p className="wallet-manager-pane-title">Which claim</p>
            <ImportFeedback error={null} notice={credentialsImportNotice} />
            {storageReady === false ? (
              <p className="error">{storageError ?? "Browser storage is unavailable."}</p>
            ) : null}
            {recoverySessions.length === 0 ? (
              <p className="hint">
                No unfinished claim for the Aztec account in this browser.
              </p>
            ) : (
              <ul className="recovery-session-list scrollable-list" tabIndex={0} aria-label="Unfinished claims">
                {recoverySessions.map((entry) => {
                  const key = normalizeL1TxHash(entry.l1TxHash);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="recovery-session-item"
                        onClick={() => pickSession(entry)}
                      >
                        <span className="recovery-session-amount">
                          {sessionAmountFj(entry.claimAmount)} FJ → {shortHash(entry.recipient)}
                        </span>
                        <span className="hint">
                          L1 {shortHash(entry.l1TxHash)} · {phaseLabel(entry.phase)}
                          {entry.updatedAt ? ` · ${formatUpdatedAt(entry.updatedAt)}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </section>
      </div>
      {pane === "list" ? (
        <section className="bridge-layout recovery-import-card" aria-labelledby="recovery-import-title">
          <p id="recovery-import-title" className="wallet-manager-pane-title">Import claim</p>
          <p className="hint">
            Choose the claim-*.json downloaded after the L1 deposit. It must be for an Aztec
            account already in this browser; a file for another account is not saved.
          </p>
          <ClaimFileButton inputRef={claimFileRef} busy={busy} label="Import claim" onFile={pickClaimFile} />
          <ImportFeedback error={credentialsImportError} notice={null} />
        </section>
      ) : null}
      {removeOpen && showDetail && selectedSession ? createPortal(
        <div className="modal-backdrop" role="presentation" onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setRemoveOpen(false);
        }}>
          <div className="modal recovery-remove-confirm" id="recovery-remove-confirm" role="alertdialog" aria-modal="true" aria-labelledby="remove-claim-title" aria-describedby="remove-claim-description" onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) setRemoveOpen(false);
          }}>
            <p id="remove-claim-title" className="wallet-manager-pane-title">Remove this claim?</p>
            <p id="remove-claim-description" className="hint">
              This deletes the saved claim from this browser only. The Ethereum deposit is not
              undone. Without a downloaded claim JSON, this Fee Juice may be unclaimable later.
            </p>
            <div className="modal-actions">
              <button type="button" className="ghost" autoFocus disabled={busy} onClick={() => setRemoveOpen(false)}>
                Keep claim
              </button>
              <button type="button" className="recovery-confirm-delete" disabled={busy} onClick={() => {
                setRemoveOpen(false);
                void onRemoveSession(selectedSession);
              }}>
                Remove claim
              </button>
            </div>
          </div>
        </div>, document.body,
      ) : null}
    </div>
  );
}

function ClaimFileButton({
  inputRef,
  busy,
  label,
  onFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  label: string;
  onFile: (file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  return (
    <>
      <div
        className={`df-account-drop-wrap${dragging && !busy ? " is-dragging" : ""}${busy ? " is-disabled" : ""}`}
        onDragEnter={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (busy || !event.dataTransfer.files.length) return;
          if (event.dataTransfer.files.length !== 1) {
            setDropError("Choose one claim credentials file.");
            return;
          }
          setDropError(null);
          onFile(event.dataTransfer.files[0]);
        }}
      >
        <button type="button" className="df-account-drop" disabled={busy} onClick={() => inputRef.current?.click()}>
          <span className="df-account-drop-icon" aria-hidden="true">↑</span>
          <span className="df-account-drop-copy">
            <strong>{dragging ? "Drop your claim file" : label}</strong>
            <span>Drag and drop a claim JSON file here, or click to choose</span>
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="application/json,.json,.txt,text/plain"
          disabled={busy}
          aria-label="Import claim credentials JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setDropError(null);
              onFile(file);
            }
            event.target.value = "";
          }}
        />
      </div>
      {dropError ? <p className="error" role="alert">{dropError}</p> : null}
    </>
  );
}

function ImportFeedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="hint credentials-import-ok">{notice}</p> : null}
    </>
  );
}

function DetailStep({
  networkId,
  l1ExplorerUrl,
  aztecExplorerUrl,
  selectedSession,
  recoveryAccountReady,
  accountMissing,
  busy,
  error,
  onRetry,
  onWait,
  onResume,
  onDownload,
  onRemove,
  onBackToList,
}: {
  networkId: string;
  l1ExplorerUrl?: string;
  aztecExplorerUrl?: string;
  selectedSession: BridgeSessionEntry;
  recoveryAccountReady: boolean;
  accountMissing: boolean;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onWait: () => void;
  onResume: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onBackToList: () => void;
}) {
  const needsAccount =
    selectedSession.phase === "ready-to-claim" ||
    selectedSession.phase === "claiming" ||
    selectedSession.phase === "failed";
  const recipient = selectedSession.credentials?.recipient ?? selectedSession.recipient;
  const amount = sessionAmountFj(
    selectedSession.credentials?.claimAmount ?? selectedSession.claimAmount,
  );

  return (
    <>
      <button type="button" className="recovery-back" onClick={onBackToList}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M12.5 4.5 7 10l5.5 5.5M7 10h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to list
      </button>
      <p className="wallet-manager-pane-title">{detailTitle(selectedSession)}</p>
      <p className="hint">
        {amount} FJ → {shortHash(recipient)}
      </p>
      {needsAccount ? (
        <p className="hint">Claim with the Aztec account already in this browser.</p>
      ) : null}
      <TxAnalysisLinks
        networkId={networkId}
        l1ExplorerUrl={l1ExplorerUrl}
        aztecExplorerUrl={aztecExplorerUrl}
        l1TxHash={selectedSession.l1TxHash}
        l2TxHash={selectedSession.l2TxHash}
      />
      {selectedSession.lastError ? <p className="error">{selectedSession.lastError}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {needsAccount && accountMissing ? (
        <p className="error">
          This claim is not for the Aztec account in this browser, so it will not be processed.
        </p>
      ) : null}

      {selectedSession.phase === "claim-sent" ? (
        <p className="hint">You can leave this page. The claim finishes on Aztec.</p>
      ) : null}

      <div className="recovery-actions">
        {selectedSession.phase === "l1-pending" ? (
          <button type="button" disabled={busy} onClick={onRetry}>
            {busy ? "Working…" : "Retry"}
          </button>
        ) : null}

        {selectedSession.phase === "claim-sent" ? (
          <button type="button" disabled={busy} onClick={onWait}>
            {busy ? "Working…" : "Wait for confirmation"}
          </button>
        ) : null}

        {needsAccount && recoveryAccountReady ? (
          <button
            type="button"
            className="recovery-resume"
            disabled={busy}
            onClick={onResume}
          >
            {busy ? "Working…" : "Resume claim"}
          </button>
        ) : null}

        {selectedSession.credentials ? (
          <button type="button" className="ghost" onClick={onDownload}>
            Download claim JSON
          </button>
        ) : null}
        <button type="button" className="recovery-remove" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
    </>
  );
}

function detailTitle(entry: BridgeSessionEntry): string {
  if (entry.phase === "l1-pending") return "Waiting for Ethereum";
  if (entry.phase === "claim-sent") return "Already submitted on Aztec";
  const recipient = entry.credentials?.recipient ?? entry.recipient;
  return `Claim with ${shortHash(recipient)}`;
}

function sessionAmountFj(amount: string): string {
  try {
    return formatFjAmount(BigInt(amount), 5);
  } catch {
    return amount;
  }
}

function formatUpdatedAt(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
