import { useEffect, useRef, useState, type RefObject } from "react";
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
    onRemoveSession,
    recoveryAccountReady,
  } = flows;

  const [importOpen, setImportOpen] = useState(false);
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

  const pane = recoverProgress
    ? "progress"
    : removeOpen && showDetail
      ? "remove"
      : importOpen
        ? "import"
        : showDetail
          ? "detail"
          : "list";

  const pickSession = (entry: BridgeSessionEntry) => {
    setRemoveOpen(false);
    setImportOpen(false);
    void selectRecoverySession(entry);
  };

  const pickClaimFile = (file: File | null) => {
    void onClaimCredentialsFile(file);
    setImportOpen(false);
  };

  const backToList = () => {
    setRemoveOpen(false);
    setImportOpen(false);
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
    <div className="bridge-layout recover-layout" aria-label="Recover">
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
              if (!selectedSession) return;
              if (progress.track === "claim") void onResumeClaim(selectedSession);
              else if (progress.track === "resume-l1") void retryResumeL1(selectedSession);
              else if (progress.track === "wait-l2") void waitForSessionL2(selectedSession);
            }}
          />
        ) : null}

        {pane === "import" ? (
          <div className="df-pxe-format-pane">
            <p className="wallet-manager-pane-title">Import claim</p>
            <p className="hint">
              Pick the claim-*.json downloaded after the L1 deposit. It has to be for the Aztec
              account already in this browser. A file for another account is not saved.
            </p>
            <ClaimFileButton
              inputRef={claimFileRef}
              busy={busy}
              label="Choose claim JSON"
              onFile={pickClaimFile}
            />
            <ImportFeedback
              error={credentialsImportError}
              notice={credentialsImportNotice}
            />
            <button type="button" className="ghost" onClick={() => setImportOpen(false)}>
              Back
            </button>
          </div>
        ) : null}

        {pane === "remove" && selectedSession ? (
          <div className="df-pxe-format-pane">
            <p className="wallet-manager-pane-title">Think twice before removing</p>
            <p className="hint">
              This only deletes the saved claim from this browser. The Ethereum deposit is not
              undone. Without a downloaded claim JSON, this Fee Juice may be unclaimable later.
            </p>
            <button type="button" onClick={() => setRemoveOpen(false)}>
              Keep this claim
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setRemoveOpen(false);
                void onRemoveSession(selectedSession);
              }}
            >
              Delete anyway
            </button>
          </div>
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
            {storageReady === false ? (
              <p className="error">{storageError ?? "Browser storage is unavailable."}</p>
            ) : null}
            {recoverySessions.length === 0 ? (
              <>
                <p className="hint">
                  No unfinished claim for the Aztec account in this browser. Import the claim-*.json
                  downloaded after the L1 deposit.
                </p>
                <ClaimFileButton
                  inputRef={claimFileRef}
                  busy={busy}
                  label="Import claim"
                  onFile={pickClaimFile}
                />
                <ImportFeedback
                  error={credentialsImportError}
                  notice={credentialsImportNotice}
                />
              </>
            ) : (
              <>
                <ul className="recovery-session-list">
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
                            {phaseLabel(entry.phase)}
                            {entry.updatedAt ? ` · ${formatUpdatedAt(entry.updatedAt)}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <ImportFeedback
                  error={credentialsImportError}
                  notice={credentialsImportNotice}
                />
                <button type="button" className="ghost" onClick={() => setImportOpen(true)}>
                  Import claim
                </button>
              </>
            )}
          </>
        ) : null}
      </section>
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
  return (
    <>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept="application/json,.json,.txt,text/plain"
        disabled={busy}
        aria-label="Import claim credentials JSON"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          onFile(file);
          e.target.value = "";
        }}
      />
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
        <button type="button" className="ghost" onClick={onRemove}>
          Remove
        </button>
        <button type="button" className="ghost" onClick={onBackToList}>
          Back to list
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
