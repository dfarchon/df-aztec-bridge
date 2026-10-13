import type { CSSProperties } from "react";
import { formatEther } from "viem";
import { BRIDGE_FEE_BPS, shouldChargeBridgeEthServiceFee } from "@df-bridge/browser-sdk";
import { hasRpcOverrides } from "../../../lib/rpc-overrides.ts";
import {
  amountFromSlider,
  amountPresets,
  AMOUNT_SLIDER_MAX,
  formatFjAmount,
  formatSliderAmount,
  isDraftAmountInput,
  MIN_BRIDGE_FJ,
  parseAmountWeiLoose,
  sanitizeAmountInput,
  sliderFromAmount,
} from "../../../lib/bridge-amount.ts";
import { downloadClaimCredentials } from "../../../lib/claim-credentials-store.ts";
import { isSponsoredFpcAddress } from "../../../lib/sponsored-fpc.ts";
import { shortHash } from "../../../lib/claim-recovery.ts";
import { TxAnalysisLinks } from "../../../components/ui/TxAnalysisLinks.tsx";
import { ActionHintButton } from "../../../components/ui/ActionHintButton.tsx";
import { ROUTES } from "../../../app/routes.ts";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";

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

  const tokenSymbol = feeBalance?.symbol ?? "AZTEC";
  const amountDraft = isDraftAmountInput(amountFj);
  const amountInvalid = Boolean(amountFj.trim() && !amountDraft && (amountCheck.error || shortfall));
  const sliderEnabled = Boolean(feeBalance && feeBalance.balance > 0n);
  const sliderValue =
    feeBalance && feeBalance.balance > 0n
      ? sliderFromAmount(feeBalance.balance, parseAmountWeiLoose(amountFj))
      : 0;
  const amountPresetActions = feeBalance ? amountPresets(feeBalance.balance) : [];
  const selectedPreset = amountPresetActions.find((row) => row.amountFj === amountFj.trim())?.percent ?? null;
  const feeHint =
    feeSplit && !amountCheck.error
      ? `You receive ${formatFjAmount(feeSplit.net)} FJ · fee ${BRIDGE_FEE_BPS / 100}%${
          ethServiceFeeWei != null && ethServiceFeeWei > 0n
            ? ` · ETH ${formatEther(ethServiceFeeWei)}`
            : networkMeta && shouldChargeBridgeEthServiceFee(networkMeta.l1ChainId)
              ? " · ETH fee…"
              : ""
        }`
      : null;
  const amountHelp =
    amountDraft
      ? `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`
      : amountCheck.error
        ? amountCheck.error
        : shortfall
          ? `Insufficient ${tokenSymbol}`
          : feeHint ?? `Minimum ${MIN_BRIDGE_FJ} FJ per bridge.`;

  const applyAmountFj = (next: string) => {
    setAmountFj(next);
    setError(null);
  };

  return (
      <div className="bridge-layout">
      {hasRpcOverrides(rpcOverrides) ? (
        <p className="hint bridge-layout-hint">
          Custom RPC overrides active — verify hosts before signing.
        </p>
      ) : null}

      <section className="bridge-step">
          <p className="wallet-manager-pane-title">From Ethereum</p>
          {wallet ? (
            <div className="bridge-accounts">
              <div className="bridge-account">
                <strong className="wallet-manager-account-kicker">L1 account</strong>
                <div className="wallet-manager-address">
                  <span className="wallet-manager-address-text mono">
                    {shortHash(wallet.address)}
                  </span>
                </div>
                {networkMeta && wallet.chainId !== networkMeta.l1ChainId ? (
                  <p className="hint error">
                    Switch wallet to chain {networkMeta.l1ChainId}.
                  </p>
                ) : null}
                <div className="bridge-account-balance">
                  {feeBalance ? (
                    <span
                      className="balance-amount"
                      title={`${feeBalance.formatted} ${feeBalance.symbol}`}
                    >
                      {formatFjAmount(feeBalance.balance, 5)}{" "}
                      <span className="balance-symbol">{feeBalance.symbol}</span>
                    </span>
                  ) : (
                    <span className={`balance-amount hint ${balanceError ? "error" : ""}`}>
                      {balanceError ? "Failed" : balanceRefreshing ? "…" : "—"}
                    </span>
                  )}
                  <RefreshBalanceButton
                    spinning={balanceRefreshing}
                    disabled={busy || !networkMeta || balanceRefreshing}
                    label="Refresh L1 balance"
                    onClick={() => {
                      if (wallet && networkMeta) {
                        void refreshFeeBalance(wallet, networkMeta, { spin: true });
                      }
                    }}
                  />
                </div>
                {!balanceRefreshing && balanceError ? (
                  <p className="hint error balance-error">{balanceError}</p>
                ) : null}
              </div>
              <div className="bridge-account">
                <strong className="wallet-manager-account-kicker">Aztec account</strong>
                {recipient.trim() ? (
                  <div className="wallet-manager-address">
                    <span className="wallet-manager-address-text mono">
                      {shortHash(recipient)}
                    </span>
                  </div>
                ) : (
                  <p className="hint">Import a DF Punk account.</p>
                )}
                {dfPxeReady ? (
                  <div className="bridge-account-balance">
                    <span
                      className="balance-amount"
                      title={l2FeeBalance != null ? `${formatFjAmount(l2FeeBalance)} FJ` : undefined}
                    >
                      {l2FeeBalance != null ? (
                        <>
                          {formatFjAmount(l2FeeBalance, 5)} <span className="balance-symbol">FJ</span>
                        </>
                      ) : (
                        "— FJ"
                      )}
                    </span>
                    <RefreshBalanceButton
                      spinning={l2BalanceRefreshing}
                      disabled={busy || !networkMeta || l2BalanceRefreshing}
                      label="Refresh Fee Juice balance"
                      onClick={() => {
                        if (dfPxeAccount?.address && networkMeta?.aztecNodeUrl) {
                          void refreshL2FeeBalance(dfPxeAccount.address, networkMeta.aztecNodeUrl, {
                            spin: true,
                          });
                        }
                      }}
                    />
                  </div>
                ) : null}
                {!l2BalanceRefreshing && l2BalanceError ? (
                  <p className="hint error balance-error">{l2BalanceError}</p>
                ) : null}
              </div>
            </div>
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
          {progress || !busy || !bridgePhase ? null : (
            <p className="bridge-phase active">
              ⏳ {bridgePhase}
            </p>
          )}
      </section>

      <section className="bridge-step">
          <p className="wallet-manager-pane-title">Amount and claim</p>
          <div className="bridge-amount-card">
            <div className="amount-field">
              <div className="dex-pay-head">
                <label htmlFor="bridge-amount-input">You pay</label>
              </div>
              <input
                type="range"
                className="bridge-amount-slider"
                min={0}
                max={AMOUNT_SLIDER_MAX}
                step={1}
                value={sliderValue}
                disabled={busy || !sliderEnabled}
                aria-label="Bridge amount"
                aria-valuetext={amountFj.trim() ? `${amountFj} ${tokenSymbol}` : `0 ${tokenSymbol}`}
                style={{ "--amount-slider-fill": `${(sliderValue / AMOUNT_SLIDER_MAX) * 100}%` } as CSSProperties}
                onChange={(event) => {
                  if (!feeBalance) return;
                  const wei = amountFromSlider(feeBalance.balance, Number(event.target.value));
                  applyAmountFj(wei === 0n ? "" : formatSliderAmount(wei));
                }}
              />
              <div className="bridge-amount-input-wrap">
                <input
                  id="bridge-amount-input"
                  value={amountFj}
                  onChange={(event) => applyAmountFj(sanitizeAmountInput(event.target.value))}
                  inputMode="decimal"
                  placeholder="0"
                  autoComplete="off"
                  className={amountInvalid ? "bridge-amount-input input-invalid" : "bridge-amount-input"}
                  aria-invalid={amountInvalid ? true : undefined}
                  aria-describedby="bridge-amount-help"
                />
                <span className="bridge-amount-unit">{tokenSymbol}</span>
              </div>
              <div className="dex-pay-meta">
                {wallet && feeBalance ? (
                  <span
                    className="hint amount-balance"
                    title={`${formatFjAmount(feeBalance.balance)} ${feeBalance.symbol}`}
                  >
                    {formatFjAmount(feeBalance.balance, 5)} {feeBalance.symbol}
                  </span>
                ) : (
                  <span className="hint amount-balance">Balance —</span>
                )}
                {amountPresetActions.length ? (
                  <div className="bridge-amount-presets">
                    {amountPresetActions.map((row) => (
                      <button
                        key={row.percent}
                        type="button"
                        className={`ghost bridge-amount-preset${selectedPreset === row.percent ? " is-active" : ""}`}
                        disabled={busy || balanceRefreshing || row.disabled}
                        onClick={() => applyAmountFj(row.amountFj)}
                      >
                        {row.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p
                id="bridge-amount-help"
                className={amountInvalid ? "error" : "hint"}
              >
                {amountHelp}
              </p>
            </div>
          </div>

          <label className="check bridge-autoclaim">
            <input
              type="checkbox"
              checked={autoClaim}
              onChange={(e) => setAutoClaim(e.target.checked)}
            />
            <span>Claim on Aztec after this transaction.</span>
          </label>

          {autoClaim ? null : (
            <p className="hint">
              Auto-claim off. Download credentials after L1 and claim via CLI later.
            </p>
          )}

          <ActionHintButton
            label={busy ? "Working…" : bridgeButtonLabel}
            ready={canBridge}
            busy={busy}
            onClick={requestBridge}
          />
      </section>

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

function RefreshBalanceButton({
  spinning,
  disabled,
  label,
  onClick,
}: {
  spinning: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`icon-btn utility-control bridge-refresh-btn${spinning ? " spinning" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
        />
      </svg>
    </button>
  );
}
