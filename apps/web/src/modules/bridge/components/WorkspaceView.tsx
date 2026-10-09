import { BRIDGE_FEE_BPS } from "@df-bridge/browser-sdk";
import { isBridgeReadyDfPxeAccount } from "../../../lib/df-pxe-bridge-guard.ts";
import { ConnectSessionGate } from "../../../components/ui/ConnectSessionGate.tsx";
import { ProgressPanel } from "../../../components/ui/ProgressPanel.tsx";
import { TopBar } from "../../../components/layout/TopBar.tsx";
import { WalletDrawer } from "../../../components/wallet/WalletDrawer.tsx";
import { WalletManagerPanel } from "../../wallet/WalletManagerPanel.tsx";
import { VaultPage } from "../../vault/VaultPage.tsx";
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

export function WorkspaceView({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
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
walletConnectError, setWalletConnectError, addressCopied, setAddressCopied, pxeAddressCopied, setPxeAddressCopied,
wcUri, setWcUri, wallet, setWallet, ethSessionOk, setEthSessionOk, dfPxeAccount, setDfPxeAccount,
gateImportingPxe, setGateImportingPxe, gateUnlockingVault, setGateUnlockingVault, gateImportError, setGateImportError,
walletPickerRef, copyResetTimerRef,
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
copyWalletAddress, copyPxeAddress,
  } = session;
  const {
    startClaimJob, onBridge, selectRecoverySession, onClaimCredentialsFile, retryResumeL1, waitForSessionL2,
onResumeClaim, onRemoveSession, amountCheck, feeSplit, canMintFeeJuice, shortfall, fundingSponsoredFpc,
dfPxeReady, canBridge, bridgeButtonLabel, recoveryAccountReady, amountQuickAction, applyAmountQuickFill,
requestBridge,
  } = flows;

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
            />
          }
        />

      ) : (
        <>
      {path === ROUTES.bridge ? null : (
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
      <div className="bridge-alert-row">
      <div className="fee-juice-notice" role="note">
        <div className="fee-juice-notice-content">
          <strong className="fee-juice-notice-title">
            <span className="fee-juice-notice-icon" aria-hidden="true">
              !
            </span>
            Important — read before bridging
          </strong>
          <p>
            Bridging is <strong>one-way and irreversible</strong>. Once on Aztec, your
            $AZTEC becomes Fee Juice — it cannot be withdrawn, transferred to another
            account, or bridged back to Ethereum or another chain.{" "}
            <strong className="fee-juice-emphasis">Only bridge the amount you need.</strong>{" "}
            A {BRIDGE_FEE_BPS / 100}% AZTEC fee, plus a mainnet ETH service fee of about one L1
            transaction, goes to the DF Archon team.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn notice-details-btn"
          aria-label="Details"
          title="Details"
          onClick={() => setFeeJuiceDetailsOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M10.5 16.5h3v3h-3v-3zm1.5-13c2.9 0 5.25 1.85 5.25 4.35 0 2.1-1.35 3.15-2.55 3.9-.9.6-1.35 1.05-1.35 1.8v.7h-2.7v-.9c0-1.5.9-2.4 1.95-3.15 1.05-.75 1.8-1.35 1.8-2.4 0-1.05-.9-1.8-2.25-1.8-1.5 0-2.55.9-2.7 2.25H6.75C7.05 5.7 8.85 3.5 12 3.5z"
            />
          </svg>
        </button>
      </div>
      <NetworkIntegrityPanel network={networkMeta} />
      </div>
      ) : null}

      {path === ROUTES.vault ? (
        <section className="route-page" aria-label="Vault">
          <VaultPage />
        </section>
      ) : null}

      {path !== ROUTES.vault && wallet && ethSessionOk ? (
        <>
          {path === ROUTES.bridge ? <BridgeRoute session={session} flows={flows} /> : null}
          {path === ROUTES.recover ? <RecoverRoute session={session} flows={flows} /> : null}
        </>
      ) : null}
      {path === ROUTES.bridge || progress || !bridgePhase ? null : (
        <p className={`bridge-phase${busy ? " active" : ""}`}>
          {busy ? "⏳ " : "✓ "}
          {bridgePhase}
        </p>
      )}

      {error ? <p className="error">{error}</p> : null}

      {progress ? (
        <ProgressPanel
          progress={progress}
          detail={bridgePhase}
          aztecNodeUrl={networkMeta?.aztecNodeUrl}
          networkId={networkId}
          onDismiss={() => {
            setProgress(null);
            setBridgePhase(null);
          }}
        />      ) : null}

        </>
      )}
      <WalletDrawer
        networkId={networkId}
        rpcOverrides={rpcOverrides}
        aztecNodeUrl={networkMeta?.aztecNodeUrl ?? null}
        busy={busy}
        connectingWallet={connectingWallet}
        connectError={walletConnectError}
        ethWallet={wallet}
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
      />

      <WorkspaceModals session={session} flows={flows} />
    </main>
    </>
  );
}
