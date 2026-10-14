import { formatEther } from "viem";
import { BRIDGE_FEE_BPS } from "@df-bridge/browser-sdk";
import { getNetwork } from "../../../config/networks.ts";
import { hasRpcOverrides } from "../../../lib/rpc-overrides.ts";
import { phaseLabel } from "../../../lib/claim-recovery.ts";
import { formatFjAmount } from "../../../lib/bridge-amount.ts";
import { useNetwork } from "../../../providers/NetworkProvider.tsx";
import { ROUTES } from "../../../app/routes.ts";
import {
  API_BASE,
  BRIDGE_FEE_RECIPIENT,
  BRIDGE_PUBLIC_URL,
  DFPUNK_PLAY_URL,
  WC_PROJECT_ID,
} from "../config.ts";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";

export function WorkspaceModals({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
  const {
    path, navigate,
networkId, networkMeta, l1Backend, rpcOverrides, settingsOpen, openSettings, closeSettings,
draftAztecUrl, setDraftAztecUrl, saveSettings, resetSettingsDraft,
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
  const { settingsError } = useNetwork();
  const defaultAztecUrl = getNetwork(networkId).aztecNodeUrl;
  const liveAztecUrl = networkMeta?.aztecNodeUrl ?? defaultAztecUrl;
  const {
    startClaimJob, onBridge, selectRecoverySession, onClaimCredentialsFile, retryResumeL1, waitForSessionL2,
onResumeClaim, onRemoveSession, amountCheck, feeSplit, canMintFeeJuice, shortfall, fundingSponsoredFpc,
dfPxeReady, canBridge, bridgeButtonLabel, recoveryAccountReady,
requestBridge,
  } = flows;

  return (
    <>
      {bridgeConfirmOpen ? (
        <div
          className="modal-backdrop bridge-confirm-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBridgeConfirmOpen(false);
          }}
        >
          <div
            className="modal bridge-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bridge-confirm-title"
          >
            <div className="modal-header">
              <p id="bridge-confirm-title" className="wallet-manager-pane-title">
                Protect your claim credentials
              </p>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                title="Close"
                onClick={() => setBridgeConfirmOpen(false)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                  />
                </svg>
              </button>
            </div>
            <div className="bridge-confirm-copy">
              <p className="wallet-manager-pane-title">
                Claim credentials are required to recover your funds on Aztec.
              </p>
              <p className="hint">
                This browser will automatically save recovery data as soon as the L1
                transaction is submitted. After L1 confirmation, the complete credentials
                JSON will download automatically.
              </p>
              {ethServiceFeeWei != null && ethServiceFeeWei > 0n ? (
                <p className="hint">
                  Mainnet wallet confirm batches ETH service fee {formatEther(ethServiceFeeWei)} ETH
                  + {BRIDGE_FEE_BPS / 100}% AZTEC fee + approve + deposit to{" "}
                  {BRIDGE_FEE_RECIPIENT.slice(0, 10)}… when your wallet supports batching.
                </p>
              ) : null}
              <p className="hint">
                Complete credentials do not exist until the L1 receipt is confirmed. Keep
                this page open, allow the download, and store the JSON somewhere safe.
              </p>
            </div>
            <p className={storageReady ? "hint storage-status-ok" : "error storage-status-error"}>
              {storageReady === null
                ? "Checking browser storage…"
                : storageReady
                  ? "Browser storage ready. Recovery data will be saved in this browser."
                  : storageError ?? "Browser storage unavailable. Recovery data cannot be saved."}
            </p>
            <label className="check bridge-confirm-check">
              <input
                type="checkbox"
                checked={recoveryAcknowledged}
                onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
              />
              <span>
                I understand that I must keep the downloaded claim credentials until the L2
                claim succeeds.
              </span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setBridgeConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!recoveryAcknowledged || storageReady !== true}
                onClick={() => {
                  setBridgeConfirmOpen(false);
                  void onBridge();
                }}
              >
                Continue to wallet
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {recoveryPromptOpen && selectedSession?.credentials ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal recovery-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-recovery-title"
          >
            <div className="modal-header">
              <strong id="claim-recovery-title">Unfinished claim found</strong>
            </div>
            <p className="hint">
              {phaseLabel(selectedSession.phase)} —{" "}
              <span className="mono">
                {formatFjAmount(BigInt(selectedSession.credentials.claimAmount), 5)} FJ
              </span>{" "}
              is still waiting.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setRecoveryPromptOpen(false);
                  navigate(ROUTES.bridge);
                }}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryPromptOpen(false);
                  void selectRecoverySession(selectedSession);
                  navigate(ROUTES.recover);
                  window.setTimeout(() => {
                    document
                      .getElementById("recovery-session-guide")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 0);
                }}
              >
                {selectedSession.phase === "claim-sent"
                  ? "Wait for confirmation"
                  : "Resume claim"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSettings();
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rpc-settings-title">
            <div className="modal-header">
              <strong id="rpc-settings-title">RPC</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                title="Close"
                onClick={() => closeSettings()}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
                  />
                </svg>
              </button>
            </div>
            <p className="hint">Set the Aztec RPC.</p>
            <div className="rpc-using">
              <div className="rpc-using-head">
                <span className="label">Using</span>
                <span className="label">{hasRpcOverrides(rpcOverrides) ? "Custom" : "Default"}</span>
              </div>
              <p className="rpc-using-url">{liveAztecUrl}</p>
            </div>
            <label>
              RPC URL
              <input
                value={draftAztecUrl}
                onChange={(e) => setDraftAztecUrl(e.target.value)}
                placeholder={defaultAztecUrl}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {settingsError ? <p className="hint error">{settingsError}</p> : null}
            <div className="modal-actions rpc-settings-actions">
              <button
                type="button"
                className="ghost"
                onClick={resetSettingsDraft}
                disabled={draftAztecUrl.trim() === defaultAztecUrl}
              >
                Reset to default
              </button>
              <div className="rpc-settings-actions-end">
                <button type="button" className="ghost" onClick={() => closeSettings()}>
                  Cancel
                </button>
                <button type="button" onClick={saveSettings}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}
