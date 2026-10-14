import { useState } from "react";
import { BRIDGE_FEE_BPS } from "@df-bridge/browser-sdk";
import { isBridgeReadyDfPxeAccount } from "../../../lib/df-pxe-bridge-guard.ts";
import { ConnectSessionGate } from "../../../components/ui/ConnectSessionGate.tsx";
import { ProgressPanel } from "../../../components/ui/ProgressPanel.tsx";
import { TopBar } from "../../../components/layout/TopBar.tsx";
import { WalletDrawer } from "../../../components/wallet/WalletDrawer.tsx";
import { WalletManagerPanel } from "../../wallet/WalletManagerPanel.tsx";
import { VaultPage } from "../../vault/VaultPage.tsx";
import { HistoryPage } from "../../history/HistoryPage.tsx";
import { NetworkIntegrityPanel } from "../../network/NetworkIntegrityPanel.tsx";
import { ROUTES } from "../../../app/routes.ts";
import {
  BROWSER_CLAIM,
  BRIDGE_FEE_RECIPIENT,
  BRIDGE_PUBLIC_URL,
  DFPUNK_PLAY_URL,
  WC_PROJECT_ID,
} from "../config.ts";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";
import { BridgeRoute } from "./BridgeRoute.tsx";
import { RecoverRoute } from "./RecoverRoute.tsx";
import { WorkspaceModals } from "./WorkspaceModals.tsx";
import {
  BridgeRiskGate,
  BridgeRiskNoticeDialog,
  readBridgeRiskAccepted,
} from "./BridgeRiskNotice.tsx";

export function WorkspaceView({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
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
vaultTimeoutNotice,
  } = session;
  const {
    startClaimJob, claimAfterBridge, onBridge, selectRecoverySession, onClaimCredentialsFile, retryResumeL1, waitForSessionL2,
onResumeClaim, onRemoveSession, amountCheck, feeSplit, canMintFeeJuice, shortfall, fundingSponsoredFpc,
dfPxeReady, canBridge, bridgeButtonLabel, recoveryAccountReady,
requestBridge,
  } = flows;
  const [riskAccepted, setRiskAccepted] = useState(readBridgeRiskAccepted);
  const [riskNoticeOpen, setRiskNoticeOpen] = useState(false);

  const retryProgress = () => {
    if (!progress) return;
    if (progress.track === "bridge") {
      void onBridge();
      return;
    }
    if (!selectedSession) return;
    if (progress.track === "claim") void onResumeClaim(selectedSession);
    else if (progress.track === "resume-l1") void retryResumeL1(selectedSession);
    else if (progress.track === "wait-l2") void waitForSessionL2(selectedSession);
  };

  const recoverOwnsProgress =
    path === ROUTES.recover &&
    !!progress &&
    (progress.track === "claim" ||
      progress.track === "resume-l1" ||
      progress.track === "wait-l2");
  const progressPanel =
    progress && !recoverOwnsProgress ? (
    <ProgressPanel
      progress={progress}
      detail={bridgePhase}
      aztecNodeUrl={networkMeta?.aztecNodeUrl}
      networkId={networkId}
      onDismiss={() => {
        setProgress(null);
        setBridgePhase(null);
      }}
      onRetry={retryProgress}
      onClaimL2={BROWSER_CLAIM ? () => void claimAfterBridge() : undefined}
    />
  ) : null;

  return (
    <>
      <TopBar
        wallet={wallet}
        ethSessionOk={ethSessionOk}
        shellReady={shellReady}
        onConnect={() => void onConnect()}
      />

      <main className={progress ? "with-progress-panel app-shell app-main" : "app-shell app-main"}>

      {!shellReady ? (
        <ConnectSessionGate
          ethConnected={!!wallet}
          ethSessionOk={ethSessionOk}
          pxeReady={
            !!dfPxeAccount && isBridgeReadyDfPxeAccount(dfPxeAccount, wallet?.address)
          }
          vaultAvailable={vaultAvailable}
          dfpunkPlayUrl={DFPUNK_PLAY_URL}
          canImportPxe={
            ethSessionOk && BROWSER_CLAIM && !!networkMeta?.aztecNodeUrl && !!wallet
          }
          importingPxe={gateImportingPxe}
          unlockingVault={gateUnlockingVault}
          importError={gateImportError ?? walletConnectError}
          onImportPxeFile={importPxeFromGate}
          onUnlockVault={unlockVaultFromGate}
          walletPanel={
            <WalletManagerPanel
              networkId={networkId}
              rpcOverrides={rpcOverrides}
              aztecNodeUrl={networkMeta?.aztecNodeUrl ?? null}
              browserClaimEnabled={BROWSER_CLAIM}
              busy={busy || connectingWallet}
              ethWallet={wallet}
              dfpunkPlayUrl={DFPUNK_PLAY_URL}
              ethSessionOk={ethSessionOk}
              onEthSessionValidated={setEthSessionOk}
              onConnectEth={() => void onConnect()}
              onDisconnectEth={() => void onDisconnect()}
              onApplyAztecAccount={(acc) => applyImportedAccount(acc)}
              onClearAztecAccount={() => {
                setDfPxeAccount(null);
                setVaultPxeAccount(null);
                lockVaultUi();
                setRecipient("");
                setL2Secret("");
                setL2Salt("0");
                setL2SigningKey("");
              }}
              vaultTimeoutNotice={vaultTimeoutNotice}
            />
          }
        />

      ) : (
        <div className={`app-main-inner${path === ROUTES.bridge ? " app-main-inner-bridge" : ""}`}>
      {path === ROUTES.bridge ||
      path === ROUTES.recover ||
      path === ROUTES.history ||
      path === ROUTES.vault ? null : (
      <p className="brand-lead app-lead">
        Connect an Ethereum wallet, fund an Aztec address, and claim Fee Juice. Styled for the{" "}
        <a href={BRIDGE_PUBLIC_URL} target="_blank" rel="noreferrer">
          df/atlas
        </a>{" "}
        stack — play on{" "}
        <a href={DFPUNK_PLAY_URL} target="_blank" rel="noreferrer">
          dfpunk aztec
        </a>
        . Protocol fee {BRIDGE_FEE_BPS / 100}% AZTEC + mainnet ETH (~1 L1 tx) → L1 treasury.
      </p>
      )}

      {path === ROUTES.bridge ? (
      <div className="bridge-workspace">
      {riskAccepted ? (
      <div className="bridge-workspace-body">
        <div className="bridge-flow">
          <div className="bridge-flow-stage">
            {wallet && ethSessionOk ? <BridgeRoute session={session} flows={flows} /> : null}
          </div>
        </div>
        <aside className="bridge-aside">
          <button
            type="button"
            className="ghost"
            onClick={() => setRiskNoticeOpen(true)}
          >
            Risk notice
          </button>
          <NetworkIntegrityPanel network={networkMeta} />
        </aside>
      </div>
      ) : (
        <BridgeRiskGate onAccepted={() => setRiskAccepted(true)} />
      )}
      </div>
      ) : null}

      {path === ROUTES.vault ? <VaultPage /> : null}

      {path === ROUTES.history ? <HistoryPage /> : null}

      {path !== ROUTES.vault && path !== ROUTES.history && wallet && ethSessionOk ? (
        <>
          {path === ROUTES.recover ? <RecoverRoute session={session} flows={flows} /> : null}
        </>
      ) : null}
      {path === ROUTES.bridge || progress || !bridgePhase ? null : (
        <p className={`bridge-phase${busy ? " active" : ""}`}>
          {busy ? "⏳ " : "✓ "}
          {bridgePhase}
        </p>
      )}

        </div>
      )}
      <WalletDrawer
        networkId={networkId}
        rpcOverrides={rpcOverrides}
        aztecNodeUrl={networkMeta?.aztecNodeUrl ?? null}
        busy={busy}
        connectingWallet={connectingWallet}
        connectError={walletConnectError}
        ethWallet={wallet}
        ethSessionOk={ethSessionOk}
        onEthSessionValidated={setEthSessionOk}
        onConnectEth={() => void onConnect()}
        onDisconnectEth={() => void onDisconnect()}
        onApplyAztecAccount={(acc) => applyImportedAccount(acc)}
        onClearAztecAccount={() => {
          setDfPxeAccount(null);
          setVaultPxeAccount(null);
          lockVaultUi();
          setRecipient("");
          setL2Secret("");
          setL2Salt("0");
          setL2SigningKey("");
        }}
        pickerOpen={pickerOpen}
        availableWallets={availableWallets}
        connectDetail={(d) => void connectDetail(d)}
        onConnectWalletConnect={() => void onConnectWalletConnect()}
        closeWalletPicker={closeWalletPicker}
        wcUri={wcUri}
        walletPickerRef={walletPickerRef}
        wcProjectId={WC_PROJECT_ID}
        hasNetwork={!!networkMeta}
        vaultTimeoutNotice={vaultTimeoutNotice}
      />

      <WorkspaceModals session={session} flows={flows} />
      {path === ROUTES.bridge && riskNoticeOpen ? (
        <BridgeRiskNoticeDialog onClose={() => setRiskNoticeOpen(false)} />
      ) : null}
    </main>
    {progressPanel}
    </>
  );
}
