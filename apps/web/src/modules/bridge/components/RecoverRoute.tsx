import { formatUnits } from "viem";
import { phaseLabel, recoverySteps, shortHash } from "../../../lib/claim-recovery.ts";
import { downloadClaimCredentials } from "../../../lib/claim-credentials-store.ts";
import { TxAnalysisLinks } from "../../../components/ui/TxAnalysisLinks.tsx";
import { ActionHintButton } from "../../../components/ui/ActionHintButton.tsx";
import { normalizeL1TxHash } from "../../../lib/bridge-session.ts";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";
import { AccountImportCard } from "./AccountImportCard.tsx";
import { ClaimKeyFields } from "./ClaimKeyFields.tsx";

export function RecoverRoute({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
  const {
    path, navigate,
networkId, networkMeta, l1Backend, rpcOverrides, settingsOpen, openSettings, closeSettings,
draftAztecUrl, setDraftAztecUrl, draftL1RpcUrl, setDraftL1RpcUrl, saveSettings, resetSettingsDraft,
setVaultPxeAccount, requireVaultAfterPxeImport, ensureUnlocked, unlockExistingVault, vaultAvailable,
refreshVaultAvailability, secretsVisible, requestUnlock, lockVaultUi,
setShellReady, shellReady, closeWalletPanel,
feeJuiceDetailsOpen, setFeeJuiceDetailsOpen, bridgeConfirmOpen, setBridgeConfirmOpen,
recoveryAcknowledged, setRecoveryAcknowledged, recoveryPromptOpen, setRecoveryPromptOpen,
availableWallets, setAvailableWallets, pickerOpen, setPickerOpen, connectingWallet, setConnectingWallet,
walletConnectError, setWalletConnectError,
wcUri, setWcUri, wallet, setWallet, ethSessionOk, setEthSessionOk, dfPxeAccount, setDfPxeAccount,
gateImportingPxe, setGateImportingPxe, gateUnlockingVault, setGateUnlockingVault, gateImportError, setGateImportError,
walletPickerRef,
recipient, setRecipient, amountFj, setAmountFj, autoClaim, setAutoClaim, l2Secret, setL2Secret, l2Salt, setL2Salt,
l2SigningKey, setL2SigningKey, legacyAccountStyles, setLegacyAccountStyles, showL2Secret, setShowL2Secret,
busy, setBusy, error, setError, ethServiceFeeWei, setEthServiceFeeWei, bridgePhase, setBridgePhase,
progress, setProgress, l1TxHash, setL1TxHash, showBridgeResult, setShowBridgeResult,
credentials, setCredentials, claimJobId, setClaimJobId, claimStatus, setClaimStatus, l2TxHash, setL2TxHash,
feeBalance, setFeeBalance, balanceError, setBalanceError, balanceRefreshing, setBalanceRefreshing,
l2FeeBalance, setL2FeeBalance, l2BalanceError, setL2BalanceError, l2BalanceRefreshing, setL2BalanceRefreshing,
importedAccounts, setImportedAccounts, importedIndex, setImportedIndex, importName, setImportName,
importDragOver, setImportDragOver, credentialsImportError, setCredentialsImportError,
credentialsImportNotice, setCredentialsImportNotice,
recoverySessions, setRecoverySessions, selectedRecoveryHash, setSelectedRecoveryHash,
storageReady, setStorageReady, storageError, setStorageError, selectedSession, refreshSessions,
applyImportedAccount, importPxeFromGate, unlockVaultFromGate, onAccountFile,
refreshFeeBalance, refreshL2FeeBalance, refreshBalancesAfterAction,
connectDetail, onConnectWalletConnect, onConnect, closeWalletPicker, onDisconnect,
  } = session;
  const {
    startClaimJob, onBridge, selectRecoverySession, onClaimCredentialsFile, retryResumeL1, waitForSessionL2,
onResumeClaim, onRemoveSession, amountCheck, feeSplit, canMintFeeJuice, shortfall, fundingSponsoredFpc,
dfPxeReady, canBridge, bridgeButtonLabel, recoveryAccountReady,
requestBridge,
  } = flows;

  return (
    <>
        <>
          <div className="card recovery-status">
            <strong>Browser storage</strong>
            {storageReady === null ? (
              <p className="hint">Checking storage…</p>
            ) : storageReady ? (
              <p className="hint">✓ Storage ready — recovery data persists in this browser.</p>
            ) : (
              <p className="error">{storageError ?? "Browser storage is unavailable."}</p>
            )}
          </div>

          {recoverySessions.length === 0 ? (
            <div className="card recovery-empty">
              <strong>No unfinished claim found in this browser</strong>
              <p className="hint">
                Saved sessions appear here after an L1 deposit on this device. To finish a claim
                from another browser, import the downloaded{" "}
                <span className="mono">claim-*.json</span> below.
              </p>
            </div>
          ) : (
            <div className="card recovery-session-list-card">
              <strong>Unfinished sessions ({recoverySessions.length})</strong>
              <ul className="recovery-session-list">
                {recoverySessions.map((session) => {
                  const key = normalizeL1TxHash(session.l1TxHash);
                  const isSelected =
                    !!selectedSession && normalizeL1TxHash(selectedSession.l1TxHash) === key;
                  return (
                    <li
                      key={key}
                      className={`recovery-session-row${isSelected ? " active" : ""}`}
                    >
                      <button
                        type="button"
                        className="recovery-session-item"
                        onClick={() => selectRecoverySession(session)}
                      >
                        <span className="recovery-session-phase">{phaseLabel(session.phase)}</span>
                        <span className="mono recovery-session-hash">L1 {shortHash(session.l1TxHash)}</span>
                        {session.l2TxHash ? (
                          <span className="mono recovery-session-hash">
                            L2 {shortHash(session.l2TxHash)}
                          </span>
                        ) : null}
                        <span className="hint">
                          {formatUnits(BigInt(session.claimAmount), 18)} FJ →{" "}
                          {shortHash(session.recipient)}
                        </span>
                        <span className="hint">
                          Updated {new Date(session.updatedAt).toISOString()}
                        </span>
                      </button>
                      {session.credentials ? (
                        <button
                          type="button"
                          className="ghost recovery-session-download"
                          title="Download the claim credentials JSON for this bridge"
                          onClick={() =>
                            downloadClaimCredentials(
                              session.credentials!.recipient,
                              session.credentials!,
                              { l1TxHash: session.l1TxHash, networkId },
                            )
                          }
                        >
                          Download JSON
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="card credentials-import-card">
            <strong>Add a claim from a credentials JSON</strong>
            <p className="hint">
              Use this to recover a bridge made in another browser or on another device. Pick
              the <span className="mono">claim-*.json</span> that was downloaded after the L1
              deposit — it carries the claim secret, which cannot be derived from an address.
            </p>
            <label className="recovery-file-label">
              <span className="recovery-file-label-text">Choose claim-*.json</span>
              <input
                type="file"
                accept="application/json,.json,.txt,text/plain"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void onClaimCredentialsFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {credentialsImportError ? (
              <p className="error credentials-import-message">{credentialsImportError}</p>
            ) : null}
            {credentialsImportNotice ? (
              <p className="hint credentials-import-message credentials-import-ok">
                {credentialsImportNotice}
              </p>
            ) : null}
          </div>

          {selectedSession ? (
            <div className="card claim-recovery-guide" id="recovery-session-guide">
              <strong>{phaseLabel(selectedSession.phase)}</strong>
              <p className="hint">
                L1 tx: <span className="mono">{selectedSession.l1TxHash}</span>
              </p>
              {selectedSession.l2TxHash ? (
                <p className="hint">
                  L2 tx: <span className="mono">{selectedSession.l2TxHash}</span>
                </p>
              ) : null}
              <TxAnalysisLinks
                networkId={networkId}
                l1ExplorerUrl={networkMeta?.l1ExplorerUrl}
                aztecExplorerUrl={networkMeta?.aztecExplorerUrl}
                l1TxHash={selectedSession.l1TxHash}
                l2TxHash={selectedSession.l2TxHash}
              />
              {selectedSession.credentials ? (
                <p>
                  Claim amount:{" "}
                  <strong className="mono">
                    {formatUnits(BigInt(selectedSession.credentials.claimAmount), 18)} FJ
                  </strong>
                </p>
              ) : null}
              {selectedSession.lastError ? (
                <p className="error">{selectedSession.lastError}</p>
              ) : null}

              <p className="recovery-steps-title">What to do next</p>
              <ol className="recovery-steps">
                {recoverySteps(selectedSession.phase).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>

              {selectedSession.phase === "l1-pending" ? (
                <>
                  <p className="hint">
                    Waiting for L1 confirmation. This is retried automatically when the page
                    loads — you can also retry it now.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retryResumeL1(selectedSession)}
                  >
                    Retry resume
                  </button>
                </>
              ) : null}

              {selectedSession.phase === "claim-sent" ? (
                <>
                  <p className="hint">
                    The L2 claim transaction was already submitted. No account import is
                    needed — just wait for confirmation.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void waitForSessionL2(selectedSession)}
                  >
                    Wait for L2 confirmation
                  </button>
                </>
              ) : null}

              {selectedSession.phase === "ready-to-claim" ||
              selectedSession.phase === "claiming" ||
              selectedSession.phase === "failed" ? (
                <>
                  <p className="hint">
                    Import the original Aztec account JSON for{" "}
                    <span className="mono">{selectedSession.credentials?.recipient}</span> to
                    resume the L2 claim. Account keys are used only in memory and are not
                    persisted.
                  </p>
                  <AccountImportCard
                    session={session}
                    id="aztec-recovery-account-import"
                    highlight
                    hint={
                      <>
                        Upload <span className="mono">dfpunk-account-*.json</span> with{" "}
                        <span className="mono">address / secretKey / salt / signingKey</span> for{" "}
                        <span className="mono">{selectedSession.credentials?.recipient}</span>.
                        Fills the fields below (signingKey is required for dfpunk accounts).
                      </>
                    }
                    onFile={(f) =>
                      void onAccountFile(f, {
                        expectedRecipient: selectedSession.credentials?.recipient,
                        forRecovery: true,
                      })
                    }
                    onSelectAccount={(i) => {
                      setImportedIndex(i);
                      const acc = importedAccounts[i];
                      if (acc) {
                        applyImportedAccount(acc, {
                          expectedRecipient: selectedSession.credentials?.recipient,
                          forRecovery: true,
                        });
                      }
                    }}
                  />
                  <ClaimKeyFields session={session} />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={legacyAccountStyles}
                      onChange={(e) => setLegacyAccountStyles(e.target.checked)}
                    />
                    <span>
                      Also try older account styles if the 5.2 address does not match this backup.
                      Runs in the 5.2 wallet, one style at a time. Does not mark the old account as lost.
                    </span>
                  </label>
                  <label>
                    Aztec recipient address
                    <input
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x… (32-byte Aztec address)"
                      readOnly={!!selectedSession.credentials?.recipient}
                    />
                  </label>
                  <ActionHintButton
                    label={
                      busy
                        ? "Working…"
                        : recoveryAccountReady
                          ? "Resume L2 claim"
                          : "Import the matching account to continue"
                    }
                    ready={recoveryAccountReady}
                    busy={busy}
                    onClick={() => void onResumeClaim(selectedSession)}
                  />
                </>
              ) : null}

              <div className="modal-actions recovery-session-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void onRemoveSession(selectedSession)}
                >
                  Remove session
                </button>
              </div>
            </div>
          ) : null}
        </>

    </>
  );
}
