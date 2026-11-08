import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, formatUnits, type Hex } from "viem";
import {
  bridgeFromConnectedWallet,
  connectEvmWalletDetail,
  connectWalletConnect,
  disconnectWalletConnect,
  discoverWallets,
  formatWalletError,
  getFeeJuiceBalance,
  getL1PublicClient,
  isWalletUserRejection,
  resumePendingBridge,
  switchWalletChain,
  watchProviderSession,
  computeBridgeFee,
  BRIDGE_FEE_BPS,
  resolveBridgeEthServiceFee,
  shouldChargeBridgeEthServiceFee,
  type BridgeProgressPhase,
  type ClaimCredentials,
  type ConnectedWallet,
  type EIP6963ProviderDetail,
  type FeeJuiceBalance,
  type PendingBridge,
} from "@df-bridge/browser-sdk";
import {
  DEFAULT_NETWORK_ID,
  getNetwork,
  type WebNetworkConfig,
} from "../../../config/networks.ts";
import {
  assertDfClientAccount,
  readAccountFile,
  type ImportedAztecAccount,
} from "../../../lib/account-import.ts";
import {
  assertBridgeStorageReady,
  BridgeStorageError,
  getActiveSession,
  listIncompleteSessions,
  normalizeL1TxHash,
  removeSession,
  setActiveSession,
  upsertSession,
  type BridgeSessionEntry,
} from "../../../lib/bridge-session.ts";
import { phaseLabel, recoverySteps, selectSessionForUi, shortHash } from "../../../lib/claim-recovery.ts";
import {
  bridgeShortfall,
  parseBridgeAmount,
} from "../../../lib/bridge-amount.ts";
import { parseClaimCredentialsFile } from "../../../lib/claim-credentials-import.ts";
import {
  downloadClaimCredentials,
  downloadJson,
} from "../../../lib/claim-credentials-store.ts";
import {
  advanceProgress,
  bridgePhaseStep,
  claimPhaseStep,
  finishProgress,
  shouldBlockUnload,
  startProgress,
  type ProgressState,
} from "../../../lib/progress-track.ts";
import {
  hasRpcOverrides,
} from "../../../lib/rpc-overrides.ts";import { formatDappError, logDappError, pushDappLog, pushL1TxDappLog, pushL2TxDappLog } from "../../../lib/dapp-log.ts";
import { importDfPunkFileIntoPxe, registerDfPunkAccountIntoPxe } from "../../../lib/df-pxe-import.ts";
import { saveAztecWallet } from "../../../lib/aztec-wallet-store.ts";
import {
  AZTEC_MAINNET_NODE_PUBLIC,
  OFFICIAL_DOCS_FEE_JUICE,
} from "../../../lib/official-links.ts";
import {
  isSponsoredFpcAddress,
} from "../../../lib/sponsored-fpc.ts";
import {
  assertBridgeReadyDfPxeAccount,
  isBridgeReadyDfPxeAccount,
  isInspectableDfAccount,
} from "../../../lib/df-pxe-bridge-guard.ts";
import {
  isTrustedConnector,
  validateConnectedWalletSession,
} from "../../../lib/wallet-session-guard.ts";
import { LEGACY_WALLET_RDNS } from "@df-bridge/browser-sdk";
import { ROUTES } from "../../../app/routes.ts";import { assertSafeClaimApiBase } from "../../../lib/api-base.ts";
import {
  API_BASE,
  BROWSER_CLAIM,
  BRIDGE_FEE_RECIPIENT,
  BRIDGE_PUBLIC_URL,
  DFPUNK_PLAY_URL,
  WC_PROJECT_ID,
} from "../config.ts";
import { readClaimApiJobResponse, resolveClaimSigningKey, storageErrorMessage } from "../tools.ts";
import type { BridgeSession } from "./useBridgeSession.ts";

/** Claim-job polling, unload guard, and bridge form derived state. */
export function useBridgeActivity(session: BridgeSession) {
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
vaultTimeoutNotice,
  } = session;

  useEffect(() => {
    if (!claimJobId || claimJobId === "browser" || !l1TxHash) return;
    const currentL1Hash = l1TxHash;
    const t = setInterval(() => {
      try {
        assertSafeClaimApiBase(API_BASE);
      } catch {
        return;
      }
      void fetch(`${API_BASE}/v1/jobs/${claimJobId}`)
        .then((response) => readClaimApiJobResponse(response, "Claim status API"))
        .then(async (job) => {
          setClaimStatus(job.status);
          if (job.status === "failed") {
            setProgress((prev) => prev?.combinedFlow ? finishProgress(prev, "failed") : prev);
            setBridgePhase(job.error ?? "Claim failed");
            setError(job.error ?? "Claim failed");
            if (credentials) {
              await upsertSession(networkId, {
                l1TxHash: currentL1Hash,
                phase: "failed",
                recipient: credentials.recipient,
                claimAmount: credentials.claimAmount,
                credentials,
                lastError: job.error ?? "Claim failed",
                makeActive: false,
              });
              await refreshSessions();
            }
            clearInterval(t);
          }
          if (job.status === "succeeded") {
            setProgress((prev) => prev?.combinedFlow ? finishProgress(prev, "succeeded") : prev);
            setBridgePhase("L2 claim complete.");
            if (job.result?.l2TxHash) setL2TxHash(job.result.l2TxHash);
            setRecoveryPromptOpen(false);
            await removeSession(networkId, currentL1Hash);
            await refreshSessions();
            clearInterval(t);
          }
        })
        .catch((cause: unknown) => {
          setProgress((prev) => prev?.combinedFlow ? finishProgress(prev, "failed") : prev);
          setError(cause instanceof Error ? cause.message : String(cause));
          clearInterval(t);
        });
    }, 3000);
    return () => clearInterval(t);
  }, [claimJobId, l1TxHash, credentials, networkId, refreshSessions]);

  // Native guard on top of the on-screen warning: reloading mid-proof throws
  // away minutes of work (credentials stay saved, so funds are never at risk).
  const blockUnload = shouldBlockUnload(progress);
  useEffect(() => {
    if (!blockUnload) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [blockUnload]);

  const lastLoggedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      lastLoggedErrorRef.current = null;
      return;
    }
    if (lastLoggedErrorRef.current === error) return;
    lastLoggedErrorRef.current = error;
    const formatted = formatDappError(error);
    pushDappLog({
      kind: "error",
      title: formatted.title,
      detail: formatted.detail,
    });
  }, [error]);

  const lastL1LogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!l1TxHash || lastL1LogRef.current === l1TxHash) return;
    lastL1LogRef.current = l1TxHash;
    pushL1TxDappLog({
      title: "L1 bridge submitted",
      txHash: l1TxHash,
      l1ExplorerUrl: networkMeta?.l1ExplorerUrl,
    });
  }, [l1TxHash, networkMeta?.l1ExplorerUrl]);

  const lastL2LogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!l2TxHash || lastL2LogRef.current === l2TxHash) return;
    lastL2LogRef.current = l2TxHash;
    pushL2TxDappLog({
      title: "L2 claim confirmed",
      txHash: l2TxHash,
      networkId,
      aztecExplorerUrl: networkMeta?.aztecExplorerUrl,
    });
  }, [l2TxHash, networkId, networkMeta?.aztecExplorerUrl]);

  const lastPhaseLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bridgePhase || busy) return;
    if (lastPhaseLogRef.current === bridgePhase) return;
    // Avoid a second toast that only repeats the L1/L2 hash we already linked.
    if (l1TxHash && bridgePhase.includes(l1TxHash)) return;
    if (l2TxHash && bridgePhase.includes(l2TxHash)) return;
    lastPhaseLogRef.current = bridgePhase;
    pushDappLog({ kind: "info", title: bridgePhase, ttlMs: 8_000 });
  }, [bridgePhase, busy, l1TxHash, l2TxHash]);

  const amountCheck = parseBridgeAmount(amountFj);
  const feeSplit =
    amountCheck.wei !== null ? computeBridgeFee(amountCheck.wei) : null;
  // Networks with a fee asset handler mint whatever the deposit needs, so a low
  // wallet balance is not a blocker there.
  const canMintFeeJuice = !!networkMeta?.l1Addresses.feeAssetHandler;
  const shortfall =
    amountCheck.wei !== null && feeBalance && !canMintFeeJuice
      ? bridgeShortfall(amountCheck.wei, feeBalance.balance)
      : null;

  const fundingSponsoredFpc = isSponsoredFpcAddress(recipient);
  const dfPxeReady =
    ethSessionOk &&
    isTrustedConnector(wallet) &&
    isBridgeReadyDfPxeAccount(dfPxeAccount, wallet?.address) &&
    !fundingSponsoredFpc;

  // Allow opening the bridge UI with a pre-v6 (v5 / v5.1) account so the warning is visible.
  // Actual bridging still requires dfPxeReady + 6.0 walletCompat.
  const sessionViewable =
    ethSessionOk &&
    isTrustedConnector(wallet) &&
    isInspectableDfAccount(dfPxeAccount, wallet?.address) &&
    !fundingSponsoredFpc;

  useEffect(() => {
    if (vaultTimeoutNotice) {
      setShellReady(false);
      return;
    }
    setShellReady(
      sessionViewable || dfPxeReady || busy || progress?.runState === "running",
    );
  }, [
    vaultTimeoutNotice,
    sessionViewable,
    dfPxeReady,
    busy,
    progress?.runState,
    setShellReady,
  ]);

  useEffect(() => {
    if (!sessionViewable) return;
    if (dfPxeAccount?.walletCompat === "pre-v6") {
      pushDappLog({
        kind: "error",
        title: "v5 / v5.1 wallet unlocked",
        detail:
          "You can view the bridge, but this address is not Aztec 6.0 — bridging is blocked. Open Wallets and verify an Aztec 6.0 address from the same keys.",
        ttlMs: 16_000,
      });
      return;
    }
    if (!dfPxeReady) return;
    pushDappLog({
      kind: "announce",
      title: "Session unlocked",
      detail: "Web3 connector + DF Punk PXE ready — menus and bridge tools are available.",
      ttlMs: 12_000,
    });
  }, [sessionViewable, dfPxeReady, dfPxeAccount?.walletCompat]);

  const recipientCompatOk =
    dfPxeAccount?.walletCompat == null ||
    dfPxeAccount.walletCompat === "v6-initializerless" ||
    dfPxeAccount.walletCompat === "v6-schnorr" ||
    dfPxeAccount.walletCompat === "v6-external";

  const canBridge =
    dfPxeReady &&
    recipientCompatOk &&
    !!networkMeta &&
    !amountCheck.error &&
    !shortfall &&
    !!BRIDGE_FEE_RECIPIENT &&
    (!autoClaim || !!l2Secret.trim() || dfPxeAccount?.connector === "nulo");
  const bridgeButtonLabel = !wallet
    ? "Connect wallet first"
    : !ethSessionOk
      ? "Validate connector session"
      : !dfPxeAccount
        ? "Import DF Punk → PXE first"
        : !recipientCompatOk
          ? "Aztec 6.0 wallet required"
          : shortfall
            ? `Insufficient ${feeBalance?.symbol ?? "AZTEC"}`
            : amountCheck.error
              ? amountCheck.error
              : !BRIDGE_FEE_RECIPIENT
                ? "Bridge fee recipient not configured"
                : autoClaim && !l2Secret.trim() && dfPxeAccount?.connector !== "nulo"
                  ? "Enter DF Punk L2 secret for auto-claim"
                  : autoClaim
                    ? "Bridge and claim"
                    : "Bridge";
  const recoveryAccountReady =
    !!selectedSession?.credentials &&
    !!l2Secret.trim() &&
    recipient.trim().toLowerCase() === selectedSession.credentials.recipient.toLowerCase();

  const requestBridge = () => {
    if (!dfPxeReady) {
      setError(
        "Bridge is locked until MetaMask/WalletConnect is validated and a DF Punk account is imported into PXE.",
      );
      return;
    }
    if (!recipientCompatOk) {
      setError(
        "This bridge is Aztec 6.0 only. The To Aztec address is a v5 / v5.1 wallet. Open Wallets and verify an Aztec 6.0 address from the same keys. Funds already sent to this address stay here.",
      );
      return;
    }
    if (amountCheck.error) {
      setError(amountCheck.error);
      return;
    }
    if (shortfall) {
      setError(`Insufficient ${feeBalance?.symbol ?? "AZTEC"} balance.`);
      return;
    }
    if (autoClaim && !l2Secret.trim() && dfPxeAccount?.connector !== "nulo") {
      setError("Auto-claim is on — DF Punk account secret missing.");
      return;
    }
    setError(null);
    setRecoveryAcknowledged(false);
    void (async () => {
      try {
        const ok = await ensureUnlocked("secrets");
        if (!ok) {
          setStorageError("Unlock the vault to save recovery sessions.");
          setStorageReady(false);
          return;
        }
        await assertBridgeStorageReady();
        setStorageReady(true);
        setStorageError(null);
        setBridgeConfirmOpen(true);
      } catch (e: unknown) {
        setStorageReady(false);
        setStorageError(storageErrorMessage(e));
      }
    })();
  };

  return {
    amountCheck,
    feeSplit,
    canMintFeeJuice,
    shortfall,
    fundingSponsoredFpc,
    dfPxeReady,
    canBridge,
    bridgeButtonLabel,
    recoveryAccountReady,
    requestBridge,
  };
}
