import { formatEther, formatUnits } from "viem";
import { BRIDGE_FEE_BPS, shouldChargeBridgeEthServiceFee } from "@df-bridge/browser-sdk";
import { hasRpcOverrides } from "../../../lib/rpc-overrides.ts";
import { formatFjAmount, MIN_BRIDGE_FJ } from "../../../lib/bridge-amount.ts";
import { downloadClaimCredentials } from "../../../lib/claim-credentials-store.ts";
import { isSponsoredFpcAddress } from "../../../lib/sponsored-fpc.ts";
import { DecodeText } from "../../../theme/DecodeText.tsx";
import { TxAnalysisLinks } from "../../../components/ui/TxAnalysisLinks.tsx";
import { ActionHintButton } from "../../../components/ui/ActionHintButton.tsx";
import { ROUTES } from "../../../app/routes.ts";
import { BROWSER_CLAIM } from "../config.ts";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";
import { ClaimKeyFields } from "./ClaimKeyFields.tsx";

export function BridgeRoute({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
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
      <div className="bridge-layout">
      {hasRpcOverrides(rpcOverrides) ? (
        <p className="hint bridge-layout-hint">
          Custom RPC overrides active — verify hosts before signing.
        </p>
      ) : null}

      <div className="bridge-grid">
        <div className="bridge-col bridge-col-account">
          <p className="bridge-col-kicker">01 · From Ethereum</p>
          {wallet ? (
            <div className="card wallet-status">
              <div className="wallet-identity-row">
              <div className="wallet-status-account">
                <strong className="account-kicker">
                  <DecodeText>L1 account</DecodeText>
                </strong>
                <div className="wallet-card-address">
                  <span className="mono">
                    {wallet.address.slice(0, 10)}…{wallet.address.slice(-8)}
                  </span>
                  <button
                    type="button"
                    className="copy-address-btn"
                    aria-label="Copy wallet address"
                    title="Copy address"
                    onClick={() => void copyWalletAddress()}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M8 7V5c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2h-2v2c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h2Zm2 0h5c1.1 0 2 .9 2 2v5h2V5h-9v2Zm-4 2v9h9V9H6Z"
                      />
                    </svg>
                  </button>
                  {addressCopied ? (
                    <span className="copy-success" role="status">
                      Copied!
                    </span>
                  ) : null}
                </div>
                <p className="hint">
                  Chain id: {wallet.chainId}
                  {networkMeta && wallet.chainId !== networkMeta.l1ChainId
                    ? ` (expected ${networkMeta.l1ChainId} — switch in wallet)`
                    : ""}
                </p>
                <p className="hint">
                  Bridging deducts from the L1 balance below.
                  {networkMeta?.l1Addresses.feeAssetHandler
                    ? " Testnet can mint via faucet if you have no tokens."
                    : " Mainnet requires L1 AZTEC + ETH for gas."}
                </p>
              </div>
              <div className="wallet-status-account">
                <strong className="account-kicker">
                  <DecodeText>PXE account</DecodeText>
                </strong>
                {recipient.trim() ? (
                  <div className="wallet-card-address">
                    <span className="mono">
                      {recipient.slice(0, 10)}…{recipient.slice(-8)}
                    </span>
                    <button
                      type="button"
                      className="copy-address-btn"
                      aria-label="Copy PXE address"
                      title="Copy PXE address"
                      onClick={() => void copyPxeAddress()}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M8 7V5c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2h-2v2c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h2Zm2 0h5c1.1 0 2 .9 2 2v5h2V5h-9v2Zm-4 2v9h9V9H6Z"
                        />
                      </svg>
                    </button>
                    {pxeAddressCopied ? (
                      <span className="copy-success" role="status">
                        Copied!
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="hint">Import a DF Punk account into PXE.</p>
                )}
                {dfPxeReady ? (
                  <p className="hint storage-status-ok">
                    Locked to this connector
                  </p>
                ) : (
                  <p className="hint">Bridge stays locked until this PXE session is ready.</p>
                )}
              </div>
              </div>
              <div className="wallet-status-balance">
                <div className="wallet-status-balance-main">
                  {feeBalance ? (
                    <span
                      className="balance-amount mono"
                      title={`${feeBalance.formatted} ${feeBalance.symbol}`}
                    >
                      {feeBalance.formatted}{" "}
                      <span className="balance-symbol">{feeBalance.symbol}</span>
                    </span>
                  ) : (
                    <span className={`balance-amount hint ${balanceError ? "error" : ""}`}>
                      {balanceError ? "Failed" : balanceRefreshing ? "…" : "—"}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`icon-btn utility-control${balanceRefreshing ? " spinning" : ""}`}
                    aria-label="Refresh balance"
                    title="Refresh balance"
                    disabled={busy || !networkMeta || balanceRefreshing}
                    onClick={() => {
                      if (wallet && networkMeta) {
                        void refreshFeeBalance(wallet, networkMeta, { spin: true });
                      }
                      if (dfPxeAccount?.address && networkMeta?.aztecNodeUrl) {
                        void refreshL2FeeBalance(dfPxeAccount.address, networkMeta.aztecNodeUrl, {
                          spin: true,
                        });
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
                      />
                    </svg>
                  </button>
                  {dfPxeReady ? (
                    <span className="balance-inline-fj mono" title={l2FeeBalance != null ? `${formatFjAmount(l2FeeBalance)} FJ` : undefined}>
                      {l2FeeBalance != null ? (
                        <>
                          {formatFjAmount(l2FeeBalance, 5)} <span className="balance-symbol">FJ</span>
                        </>
                      ) : (
                        "— FJ"
                      )}
                    </span>
                  ) : null}
                </div>
                {!balanceRefreshing && balanceError ? (
                  <p className="hint error balance-error">{balanceError}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <label className="bridge-recipient-field">
            Aztec recipient
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x… PXE address"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {dfPxeAccount &&
          recipient.trim().toLowerCase() === dfPxeAccount.address.toLowerCase() ? (
            <p className="hint">Locked PXE wallet. Edit this field to bridge to another address.</p>
          ) : recipient.trim() ? (
            <p className="hint">Bridging to a different PXE address than the unlocked wallet.</p>
          ) : null}

          {dfPxeReady ? null : (
            <p className="hint">
              Open <strong>Wallets</strong> (top right): validate MetaMask/WalletConnect, then{" "}
              <strong>Import from DF client → PXE</strong>. Generic file import does not unlock
              bridge.
            </p>
          )}

          {isSponsoredFpcAddress(recipient) ? (
            <p className="error">
              Sponsored FPC is not a DF Punk user account — bridge button stays locked. Use DF
              client import → PXE for play accounts.
            </p>
          ) : null}
          {progress ? null : bridgePhase ? (
            <p className={`bridge-phase${busy ? " active" : ""}`}>
              {busy ? "⏳ " : "✓ "}
              {bridgePhase}
            </p>
          ) : null}
        </div>

        <div className="bridge-col bridge-col-action">
          <p className="bridge-col-kicker">02 · Amount and claim</p>
          <div className="card bridge-amount-card">
            <div className="amount-field">
              <div className="amount-field-head">
                <label htmlFor="bridge-amount-input">Amount (FJ)</label>
                {wallet && feeBalance ? (
                  <div className="amount-balance-row">
                    <span className="hint amount-balance">
                      <span className="mono">
                        {formatFjAmount(feeBalance.balance)} {feeBalance.symbol}
                      </span>
                    </span>
                    {amountQuickAction ? (
                      <button
                        type="button"
                        className="ghost amount-max-btn"
                        disabled={busy || balanceRefreshing}
                        onClick={applyAmountQuickFill}
                      >
                        {amountQuickAction.label}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="bridge-amount-input-row">
                <input
                  id="bridge-amount-input"
                  value={amountFj}
                  onChange={(e) => setAmountFj(e.target.value)}
                  inputMode="decimal"
                  placeholder={`Min ${MIN_BRIDGE_FJ}`}
                  className={
                    amountFj.trim() && (amountCheck.error || shortfall)
                      ? "input-invalid bridge-amount-input"
                      : "bridge-amount-input"
                  }
                  aria-invalid={
                    amountFj.trim() && (amountCheck.error || shortfall) ? true : undefined
                  }
                  aria-describedby="bridge-amount-help"
                />
                <span className="bridge-amount-unit mono" aria-hidden="true">
                  FJ
                </span>
              </div>
              <p
                id="bridge-amount-help"
                className={
                  amountFj.trim() && (amountCheck.error || shortfall) ? "error" : "hint"
                }
              >
                {!amountFj.trim()
                  ? `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`
                  : amountCheck.error
                    ? amountCheck.error
                    : shortfall
                      ? `Insufficient balance`
                      : `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`}
              </p>
              {feeSplit && !amountCheck.error ? (
                <p className="hint fee-split mono">
                  Net {formatUnits(feeSplit.net, 18)} · fee {formatUnits(feeSplit.fee, 18)} (
                  {BRIDGE_FEE_BPS / 100}%)
                  {ethServiceFeeWei != null && ethServiceFeeWei > 0n
                    ? ` · ETH ${formatEther(ethServiceFeeWei)}`
                    : networkMeta && shouldChargeBridgeEthServiceFee(networkMeta.l1ChainId)
                      ? " · ETH fee…"
                      : ""}
                </p>
              ) : null}
            </div>
          </div>

          <label className="check bridge-autoclaim">
            <input
              type="checkbox"
              checked={autoClaim}
              onChange={(e) => setAutoClaim(e.target.checked)}
            />
            <span>
              Auto claim on L2 after bridge
              {BROWSER_CLAIM ? " (browser PXE)" : " (API)"}
            </span>
          </label>

          {autoClaim ? (
            <ClaimKeyFields session={session} />
          ) : (
            <p className="hint">
              Auto-claim off — download credentials after L1 and claim via CLI later.
            </p>
          )}

          <ActionHintButton
            label={busy ? "Working…" : bridgeButtonLabel}
            ready={canBridge}
            busy={busy}
            onClick={requestBridge}
          />
        </div>
      </div>

      {showBridgeResult && l1TxHash ? (
        <div className="card">
          <strong>L1 transaction</strong>
          <p className="mono">{l1TxHash}</p>
          <TxAnalysisLinks
            networkId={networkId}
            l1ExplorerUrl={networkMeta?.l1ExplorerUrl}
            aztecExplorerUrl={networkMeta?.aztecExplorerUrl}
            l1TxHash={l1TxHash}
            l2TxHash={l2TxHash}
          />
        </div>
      ) : null}

      {showBridgeResult && credentials ? (
        <div className="card">
          <strong>Claim credentials</strong>
          <p className="hint">
            Saved in this browser (localStorage) and auto-downloaded after L1 bridge. Keep the
            downloaded copy until the L2 claim succeeds.
          </p>
          <p className="mono">{JSON.stringify(credentials, null, 2)}</p>
          <button
            type="button"
            className="ghost"
            onClick={() =>
              downloadClaimCredentials(credentials.recipient, credentials, {
                l1TxHash: l1TxHash ?? undefined,
                networkId,
              })
            }
          >
            Download credentials JSON
          </button>

          {!autoClaim ? (
            <button
              type="button"
              onClick={() => {
                if (l1TxHash) setSelectedRecoveryHash(l1TxHash);
                navigate(ROUTES.recover);
              }}
            >
              Recover this claim
            </button>
          ) : null}

          {claimJobId ? (
            <p>
              Claim job: <span className="mono">{claimJobId}</span> — {claimStatus}
            </p>
          ) : null}
          {l2TxHash ? (
            <p>
              L2 tx: <span className="mono">{l2TxHash}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      </div>

  );
}
