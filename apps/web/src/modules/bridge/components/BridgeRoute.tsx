import { formatEther } from "viem";
import { predictBridgeReceipt, shouldChargeBridgeEthServiceFee } from "@df-bridge/browser-sdk";
import { hasRpcOverrides } from "../../../lib/rpc-overrides.ts";
import {
  amountPresets,
  formatFjAmount,
  isDraftAmountInput,
  MAX_BRIDGE_FJ,
  MAX_BRIDGE_WEI,
  MIN_BRIDGE_FJ,
  sanitizeAmountInput,
} from "../../../lib/bridge-amount.ts";
import { isSponsoredFpcAddress } from "../../../lib/sponsored-fpc.ts";
import { shortHash } from "../../../lib/claim-recovery.ts";
import { ActionHintButton } from "../../../components/ui/ActionHintButton.tsx";
import { MarqueeHint } from "../../../components/ui/MarqueeHint.tsx";
import type { BridgeSession } from "../hooks/useBridgeSession.ts";
import type { BridgeFlows } from "../hooks/useBridgeFlows.ts";

export function BridgeRoute({ session, flows }: { session: BridgeSession; flows: BridgeFlows }) {
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
l2SigningKey, setL2SigningKey, showL2Secret, setShowL2Secret,
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
  const amountPresetActions = feeBalance ? amountPresets(feeBalance.balance) : [];
  const selectedPreset = amountPresetActions.find((row) => row.amountFj === amountFj.trim())?.percent ?? null;
  const receipt = feeSplit && !amountCheck.error && !amountDraft && !shortfall
    ? predictBridgeReceipt(feeSplit.gross)
    : null;
  const amountHelp =
    amountDraft
      ? `Bridge ${MIN_BRIDGE_FJ}–${MAX_BRIDGE_FJ} ${tokenSymbol} per transaction.`
      : amountCheck.error
        ? amountCheck.error
        : shortfall
          ? `Insufficient ${tokenSymbol}`
          : `Bridge ${MIN_BRIDGE_FJ}–${MAX_BRIDGE_FJ} ${tokenSymbol} per transaction.`;

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

      <section className="bridge-step bridge-details">
          <h2 className="bridge-route-title">Bridge</h2>
          {wallet ? (
            <div className="bridge-accounts">
              <div className="bridge-account-col">
              <p className="wallet-manager-pane-title">From Ethereum:</p>
              <div className="bridge-account">
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
              </div>
              <div className="bridge-amount-section">
              <p className="wallet-manager-pane-title">Amount to claim on Aztec:</p>
              <div className="bridge-amount-card">
                <div className="amount-field">
                  <div className="dex-pay-head">
                    <label htmlFor="bridge-amount-input">You pay</label>
                  </div>
                  <div className="bridge-amount-input-wrap">
                    <input
                      id="bridge-amount-input"
                      autoFocus
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
                  {feeBalance && feeBalance.balance > MAX_BRIDGE_WEI ? (
                    <p className="hint bridge-preset-limit">Percentages are based on the {MAX_BRIDGE_FJ} {tokenSymbol} limit.</p>
                  ) : null}
                  {receipt ? (
                    <div id="bridge-amount-help" className="bridge-fee-summary">
                      <dl>
                        <div><dt>Protocol fee (5%)</dt><dd>{formatFjAmount(receipt.protocolFee, 5)} FJ</dd></div>
                        <div><dt>Estimated claim cost</dt><dd>≈ {formatFjAmount(receipt.claimFee, 5)} FJ</dd></div>
                        {ethServiceFeeWei != null && ethServiceFeeWei > 0n ? (
                          <div><dt>L1 service fee</dt><dd>{formatEther(ethServiceFeeWei)} ETH</dd></div>
                        ) : networkMeta && shouldChargeBridgeEthServiceFee(networkMeta.l1ChainId) && ethServiceFeeWei == null ? (
                          <div><dt>L1 service fee</dt><dd>Calculating…</dd></div>
                        ) : null}
                      </dl>
                      {receipt.receive === 0n ? <p className="hint">The claim may use the whole deposit.</p> : null}
                    </div>
                  ) : (
                    <MarqueeHint
                      id="bridge-amount-help"
                      className={amountInvalid ? "error" : "hint"}
                      text={amountHelp}
                    />
                  )}
                </div>
              </div>

              </div>
              <div className="bridge-account-col">
              <div className="bridge-account-col-header">
                <p className="wallet-manager-pane-title">To Aztec:</p>
                {recipient.trim() && dfPxeAccount ? (
                  <p
                    className={
                      dfPxeAccount.walletCompat === "pre-v6" ||
                      dfPxeAccount.walletCompat === "unknown" ||
                      !dfPxeAccount.walletCompat
                        ? "hint error aztec-wallet-compat"
                        : "hint aztec-wallet-compat"
                    }
                  >
                    {dfPxeAccount.walletCompat === "v6-initializerless" ||
                    dfPxeAccount.walletCompat === "v6-schnorr" ||
                    dfPxeAccount.walletCompat === "v6-external"
                      ? "Aztec v6 - OK to bridge!"
                      : dfPxeAccount.walletCompat === "pre-v6"
                        ? "v5 / v5.1 — do not bridge"
                        : "version unknown — verify before bridging"}
                  </p>
                ) : null}
              </div>
              <div className="bridge-account">
                {recipient.trim() ? (
                  <div className="wallet-manager-address">
                    <span className="wallet-manager-address-text mono">
                      {shortHash(recipient)}
                    </span>
                  </div>
                ) : (
                  <p className="hint">Import a DF Punk account.</p>
                )}
                <div className="bridge-destination-estimate">
                  <span>Estimated received</span>
                  <strong>{receipt ? `≈ ${formatFjAmount(receipt.receive, 5)} FJ` : "— FJ"}</strong>
                </div>
                {dfPxeReady ? (
                  <div className="bridge-account-balance bridge-destination-balance">
                    <span className="bridge-destination-balance-label">Current balance</span>
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
            </div>
          ) : null}

          {dfPxeAccount?.walletCompat === "pre-v6" ? (
            <p className="error">
              This Aztec address is a <strong>v5 / v5.1</strong> wallet. The same Schnorr keys can
              open an Aztec 6.0 account, but the address will be different. Bridging to this address
              stays blocked. Open <strong>Wallets</strong> and choose{" "}
              <strong>Verify Aztec 6.0 address</strong>. Fee Juice already sent here stays here.
            </p>
          ) : dfPxeReady ? null : (
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

      <section className="bridge-step bridge-actions">
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
              Auto-claim off. Credentials download after L1 — finish from Recover or CLI.
            </p>
          )}

          <ActionHintButton
            label={busy ? "Working…" : bridgeButtonLabel}
            ready={canBridge}
            busy={busy}
            onClick={requestBridge}
          />
      </section>
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
