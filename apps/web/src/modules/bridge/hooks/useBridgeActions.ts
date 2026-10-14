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
  parseEthFeeWeiOverride,
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
import {
  phaseLabel,
  sessionsForAccounts,
  shortHash,
  unknownAccountClaimMessage,
} from "../../../lib/claim-recovery.ts";
import {
  MIN_BRIDGE_FJ,
  parseBridgeAmount,
} from "../../../lib/bridge-amount.ts";
import { parseClaimCredentialsFile } from "../../../lib/claim-credentials-import.ts";
import { recordHistory } from "../../../lib/operation-history.ts";
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
} from "../../../lib/rpc-overrides.ts";
import { formatDappError, logDappError, pushDappLog, pushL1TxDappLog, pushL2TxDappLog } from "../../../lib/dapp-log.ts";
import {
  pushAppError,
  WALLET_TX_REJECTED_DETAIL,
  WALLET_TX_REJECTED_TITLE,
} from "../../../lib/app-error-toast.ts";
import { importDfPunkFileIntoPxe, registerDfPunkAccountIntoPxe } from "../../../lib/df-pxe-import.ts";
import { listStoredAztecWallets, saveAztecWallet } from "../../../lib/aztec-wallet-store.ts";
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
} from "../../../lib/df-pxe-bridge-guard.ts";
import {
  isTrustedConnector,
  validateConnectedWalletSession,
} from "../../../lib/wallet-session-guard.ts";
import { LEGACY_WALLET_RDNS } from "@df-bridge/browser-sdk";
import { ROUTES } from "../../../app/routes.ts";
import { assertSafeClaimApiBase } from "../../../lib/api-base.ts";
import {
  API_BASE,
  BROWSER_CLAIM,
  BRIDGE_ETH_FEE_WEI_OVERRIDE,
  BRIDGE_FEE_RECIPIENT,
  BRIDGE_PUBLIC_URL,
  DFPUNK_PLAY_URL,
  WC_PROJECT_ID,
} from "../config.ts";
import { readJsonResponse, resolveClaimSigningKey, storageErrorMessage } from "../tools.ts";
import type { BridgeSession } from "./useBridgeSession.ts";

/** L1 resume, bridge submit, and recovery claim actions. */
export function useBridgeActions(session: BridgeSession) {
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
recipient, amountFj, setAmountFj, autoClaim, setAutoClaim, l2Secret, l2Salt,
l2SigningKey, legacyAccountStyles, setLegacyAccountStyles, showL2Secret, setShowL2Secret,
busy, setBusy, error, setError, ethServiceFeeWei, setEthServiceFeeWei, bridgePhase, setBridgePhase,
progress, setProgress, l1TxHash, setL1TxHash, showBridgeResult, setShowBridgeResult,
credentials, setCredentials, claimJobId, setClaimJobId, claimStatus, setClaimStatus, l2TxHash, setL2TxHash,
feeBalance, setFeeBalance, balanceError, setBalanceError, balanceRefreshing, setBalanceRefreshing,
l2FeeBalance, setL2FeeBalance, l2BalanceError, setL2BalanceError, l2BalanceRefreshing, setL2BalanceRefreshing,
importDragOver, setImportDragOver, credentialsImportError, setCredentialsImportError,
credentialsImportNotice, setCredentialsImportNotice,
recoverySessions, setRecoverySessions, selectedRecoveryHash, setSelectedRecoveryHash,
storageReady, setStorageReady, storageError, setStorageError, selectedSession, refreshSessions,
applyImportedAccount, importPxeFromGate, unlockVaultFromGate, onAccountFile,
refreshFeeBalance, refreshL2FeeBalance, refreshBalancesAfterAction,
connectDetail, onConnectWalletConnect, onConnect, closeWalletPicker, onDisconnect,
  } = session;

  const endFlowFromError = useCallback((cause: unknown) => {
    if (isWalletUserRejection(cause)) {
      pushAppError({ title: WALLET_TX_REJECTED_TITLE, detail: WALLET_TX_REJECTED_DETAIL });
      setError(null);
      setBridgePhase(WALLET_TX_REJECTED_DETAIL);
      setProgress((prev) => finishProgress(prev, "rejected"));
      return;
    }
    const message = cause instanceof Error && cause.message ? cause.message : formatWalletError(cause);
    setBridgePhase(message);
    setProgress((prev) => finishProgress(prev, "failed"));
    setError(message);
  }, [setError, setBridgePhase, setProgress]);

  // On mount (once networkMeta is ready): resume every saved session that is
  // still waiting on L1 confirmation or L2 claim confirmation. Only the
  // session that was active when the page loaded also drives the top-level
  // Bridge tab UI (bridgePhase / credentials / l1TxHash); the rest are
  // updated silently in storage and show up in the Recover tab list.
  useEffect(() => {
    if (!networkMeta) return;
    let cancelled = false;

    void (async () => {
      const sessions = await refreshSessions();
      if (cancelled) return;
      const activeKey = selectedRecoveryHash
        ? normalizeL1TxHash(selectedRecoveryHash)
        : sessions[0]
          ? normalizeL1TxHash(sessions[0].l1TxHash)
          : null;

      await Promise.all(
        sessions.map(async (session) => {
          const key = normalizeL1TxHash(session.l1TxHash);
          const isActiveFlow = activeKey === key;

          if (session.phase === "l1-pending" && session.pending) {
            if (isActiveFlow) {
              setBusy(true);
              setError(null);
              setBridgePhase("Recovering pending L1 bridge from this browser…");
              setProgress(startProgress("resume-l1", "receipt"));
            }
            try {
              const result = await resumePendingBridge({
                pending: {
                  ...session.pending,
                  portal:
                    session.pending.portal ?? networkMeta.l1Addresses.feeJuicePortal,
                },
                chainId: networkMeta.l1ChainId,
                l1RpcUrl: networkMeta.l1RpcUrl,
              });
              if (cancelled) return;
              await upsertSession(networkId, {
                l1TxHash: result.l1TxHash,
              phase: "ready-to-claim",
              recipient: result.credentials.recipient,
              claimAmount: result.credentials.claimAmount,
              credentials: result.credentials,
              makeActive: false,
            });
            downloadClaimCredentials(result.credentials.recipient, result.credentials, {
              l1TxHash: result.l1TxHash,
              networkId,
            });
            if (isActiveFlow) {
              setL1TxHash(result.l1TxHash);
              setCredentials(result.credentials);
              setBridgePhase("L1 bridge recovered. Claim credentials restored.");
              setProgress((prev) => finishProgress(prev, "succeeded"));
            }
          } catch (cause: unknown) {
            if (cancelled) return;
            if (isActiveFlow) {
              setError(
                `Could not recover the pending bridge: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              );
              setBridgePhase("Pending bridge recovery failed. Saved recovery data was kept.");
              setProgress((prev) => finishProgress(prev, "failed"));
            }
          } finally {
            if (!cancelled && isActiveFlow) setBusy(false);
          }
          return;
        }

        if (session.phase === "claim-sent" && session.l2TxHash) {
          if (isActiveFlow) {
            setBridgePhase(`Waiting for L2 confirmation ${shortHash(session.l2TxHash)}…`);
            setProgress({ ...startProgress("wait-l2", "confirm"), txSubmitted: true });
          }
          try {
            const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
            const { waitForL2ClaimTx } = await loadBrowserClaim();
            await waitForL2ClaimTx({
              aztecNodeUrl: networkMeta.aztecNodeUrl,
              l2TxHash: session.l2TxHash,
            });
            if (cancelled) return;
            await removeSession(networkId, session.l1TxHash);
            if (isActiveFlow) {
              setL2TxHash(session.l2TxHash);
              setClaimStatus("succeeded");
              setBridgePhase(`L2 claim complete. ${session.l2TxHash}`);
              setProgress((prev) => finishProgress(prev, "succeeded"));
              setRecoveryPromptOpen(false);
              refreshBalancesAfterAction();
            }
          } catch (cause: unknown) {
            if (cancelled) return;
            const message = cause instanceof Error ? cause.message : String(cause);
            let recoveryError: string | null = null;
            try {
              await upsertSession(networkId, {
                l1TxHash: session.l1TxHash,
                phase: "claim-sent",
                recipient: session.recipient,
                claimAmount: session.claimAmount,
                credentials: session.credentials,
                l2TxHash: session.l2TxHash,
                lastError: message,
                makeActive: false,
              });
            } catch (storageError: unknown) {
              recoveryError = storageErrorMessage(storageError);
            }
            if (isActiveFlow) {
              setError(
                recoveryError
                  ? `${message} Recovery status could not be updated: ${recoveryError}`
                  : message,
              );
              setProgress((prev) => finishProgress(prev, "failed"));
            }
          }
        }
      }),
      );
      if (!cancelled) await refreshSessions();
    })();

    return () => {
      cancelled = true;
    };
  }, [networkMeta, networkId, selectedRecoveryHash, refreshSessions, refreshBalancesAfterAction]);

  const startClaimJob = useCallback(
    async (
      l1Hash: string,
      creds: ClaimCredentials,
      secret: string,
      salt?: string,
      signingKey?: string,
      legacyStyles?: boolean,
    ) => {
      if (BROWSER_CLAIM) {
        if (!networkMeta?.aztecNodeUrl) {
          throw new Error("Network meta missing aztecNodeUrl for browser claim.");
        }
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { waitAndClaimInBrowser, getClaimMessageStatus } = await loadBrowserClaim();

        setClaimJobId("browser");
        setClaimStatus("running");
        setL2TxHash(null);
        setBridgePhase("Checking claim message status…");
        setProgress(startProgress("claim", "status"));

        const status = await getClaimMessageStatus({
          aztecNodeUrl: networkMeta.aztecNodeUrl,
          credentials: creds,
        });
        if (status === "consumed") {
          await removeSession(networkId, l1Hash);
          await refreshSessions();
          setClaimStatus("succeeded");
          setBridgePhase("Claim message already consumed. Nothing to do.");
          setProgress((prev) => finishProgress(prev, "succeeded"));
          setRecoveryPromptOpen(false);
          void recordHistory({
            networkId,
            kind: "claim-confirmed",
            amount: creds.claimAmount,
            recipient: creds.recipient,
            l1TxHash: l1Hash,
            detail: "Claim message already consumed.",
          });
          return;
        }

        setBridgePhase("Loading browser PXE (first time may download a large chunk)…");
        setProgress((prev) => advanceProgress(prev, { track: "claim", stepKey: "pxe" }));
        await upsertSession(networkId, {
          l1TxHash: l1Hash,
          phase: "claiming",
          recipient: creds.recipient,
          claimAmount: creds.claimAmount,
          credentials: creds,
          makeActive: false,
        });
        await refreshSessions();

        let submittedHash: string | null = null;
        try {
          const { l2TxHash: hash } = await waitAndClaimInBrowser({
            aztecNodeUrl: networkMeta.aztecNodeUrl,
            networkId: networkMeta.id,
            credentials: creds,
            l2SecretKey: secret,
            salt,
            signingKey: signingKey?.trim() || undefined,
            legacyAccountStyles: legacyStyles,
            onProgress: (phase, detail) => {
              setClaimStatus(phase);
              setBridgePhase(detail ?? null);
              setProgress((prev) =>
                advanceProgress(prev, { track: "claim", stepKey: claimPhaseStep(phase) }),
              );
            },
            onTxSent: async (l2Hash) => {
              submittedHash = l2Hash;
              setL2TxHash(l2Hash);
              void recordHistory({
                networkId,
                kind: "claim-submitted",
                amount: creds.claimAmount,
                recipient: creds.recipient,
                l1TxHash: l1Hash,
                l2TxHash: l2Hash,
              });
              setProgress((prev) =>
                advanceProgress(prev, {
                  track: "claim",
                  stepKey: "confirm",
                  txSubmitted: true,
                }),
              );
              try {
                await upsertSession(networkId, {
                  l1TxHash: l1Hash,
                  phase: "claim-sent",
                  recipient: creds.recipient,
                  claimAmount: creds.claimAmount,
                  credentials: creds,
                  l2TxHash: l2Hash,
                  makeActive: false,
                });
                await refreshSessions();
              } catch (storageError: unknown) {
                downloadJson(`claim-sent-${shortHash(l1Hash)}.json`, {
                  networkId,
                  l1TxHash: l1Hash,
                  l2TxHash: l2Hash,
                  credentials: creds,
                });
                setError(
                  `L2 claim submitted, but browser recovery storage failed: ${storageErrorMessage(
                    storageError,
                  )}. A backup JSON was downloaded.`,
                );
              }
            },
          });

          if (!hash) {
            // Message was consumed mid-flight (e.g. claimed elsewhere) — nothing left to do.
            await removeSession(networkId, l1Hash);
            await refreshSessions();
            setClaimStatus("succeeded");
            setBridgePhase("Claim message already consumed. Nothing to do.");
            setProgress((prev) => finishProgress(prev, "succeeded"));
            setRecoveryPromptOpen(false);
            void recordHistory({
              networkId,
              kind: "claim-confirmed",
              amount: creds.claimAmount,
              recipient: creds.recipient,
              l1TxHash: l1Hash,
              detail: "Claim message already consumed.",
            });
            return;
          }

          setL2TxHash(hash);
          setClaimStatus("succeeded");
          setBridgePhase(`L2 claim complete. ${hash}`);
          setProgress((prev) => finishProgress(prev, "succeeded"));
          setRecoveryPromptOpen(false);
          await removeSession(networkId, l1Hash);
          await refreshSessions();
          refreshBalancesAfterAction();
          void recordHistory({
            networkId,
            kind: "claim-confirmed",
            amount: creds.claimAmount,
            recipient: creds.recipient,
            l1TxHash: l1Hash,
            l2TxHash: hash,
          });
          return;
        } catch (claimError: unknown) {
          const message = claimError instanceof Error ? claimError.message : String(claimError);
          const skipFailedSession = isWalletUserRejection(claimError) && !submittedHash;
          if (!skipFailedSession) {
            try {
              await upsertSession(networkId, {
                l1TxHash: l1Hash,
                phase: submittedHash ? "claim-sent" : "failed",
                recipient: creds.recipient,
                claimAmount: creds.claimAmount,
                credentials: creds,
                ...(submittedHash ? { l2TxHash: submittedHash } : {}),
                lastError: message,
                makeActive: false,
              });
              await refreshSessions();
            } catch (storageError: unknown) {
              if (submittedHash) {
                downloadJson(`claim-sent-${shortHash(l1Hash)}.json`, {
                  networkId,
                  l1TxHash: l1Hash,
                  l2TxHash: submittedHash,
                  credentials: creds,
                  error: message,
                });
              }
              setError(
                `Claim recovery storage failed: ${storageErrorMessage(storageError)}${
                  submittedHash ? ". A backup JSON was downloaded." : ""
                }`,
              );
            }
          }
          if (!skipFailedSession) {
            void recordHistory({
              networkId,
              kind: "claim-failed",
              amount: creds.claimAmount,
              recipient: creds.recipient,
              l1TxHash: l1Hash,
              ...(submittedHash ? { l2TxHash: submittedHash } : {}),
              detail: message,
            });
          }
          throw claimError;
        }
      }

      // Server-side claim: nothing runs in this tab, so the step panel would be
      // misleading — the polling status line covers it instead.
      setProgress(null);
      assertSafeClaimApiBase(API_BASE);
      const res = await fetch(`${API_BASE}/v1/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: networkId,
          credentials: creds,
          callerAddress: creds.recipient,
          l2SecretKey: secret,
          ...(salt?.trim() ? { salt: salt.trim() } : {}),
          ...(signingKey?.trim() ? { signingKey: signingKey.trim() } : {}),
        }),
      });
      const body = await readJsonResponse<{ jobId?: string; error?: string }>(
        res,
        "Claim API",
      );
      if (!res.ok) throw new Error(body.error ?? "Claim request failed");
      setClaimJobId(body.jobId ?? null);
      setClaimStatus("queued");
      setL2TxHash(null);
      await upsertSession(networkId, {
        l1TxHash: l1Hash,
        phase: "claiming",
        recipient: creds.recipient,
        claimAmount: creds.claimAmount,
        credentials: creds,
        claimJobId: body.jobId,
        claimChannel: "api",
        makeActive: false,
      });
      await refreshSessions();
    },
    [networkId, networkMeta, refreshSessions, refreshBalancesAfterAction],
  );

  const onBridge = useCallback(async () => {
    if (!wallet || !networkMeta) return;
    try {
      const live = await validateConnectedWalletSession(wallet);
      setWallet(live);
      assertBridgeReadyDfPxeAccount(dfPxeAccount, live.address);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (autoClaim && !l2Secret.trim()) {
      setError("Auto-claim is on — enter the Aztec L2 secret for that recipient account.");
      return;
    }
    const amount = parseBridgeAmount(amountFj);
    if (amount.wei === null) {
      setError(amount.error ?? `Minimum bridge amount is ${MIN_BRIDGE_FJ} FJ.`);
      return;
    }

    setBusy(true);
    setBridgePhase(null);
    setError(null);
    setL1TxHash(null);
    setCredentials(null);
    setShowBridgeResult(false);
    setClaimJobId(null);
    setClaimStatus(null);
    setL2TxHash(null);
    setProgress(startProgress("bridge", "prepare"));
    try {
      let provider = wallet.provider;
      let chainId = wallet.chainId;
      if (chainId !== networkMeta.l1ChainId) {
        setBridgePhase("Switch wallet to the selected L1 network…");
        await switchWalletChain(provider, networkMeta.l1ChainId);
        const refreshed = await connectEvmWalletDetail({
          info: {
            uuid: wallet.rdns ?? "connected",
            name: wallet.name ?? "Wallet",
            icon: "",
            rdns: wallet.rdns ?? "connected",
          },
          provider,
        });
        setWallet(refreshed);
        provider = refreshed.provider;
        chainId = refreshed.chainId;
      }

      const mint = networkMeta.l1Addresses.feeAssetHandler !== null;
      const backend = l1Backend;
      if (!BRIDGE_FEE_RECIPIENT || !/^0x[0-9a-fA-F]{40}$/.test(BRIDGE_FEE_RECIPIENT)) {
        throw new Error(
          "Set VITE_BRIDGE_FEE_RECIPIENT=0x… (your anonymous Trezor) in .env / Netlify env.",
        );
      }
      if (isSponsoredFpcAddress(recipient) && autoClaim) {
        throw new Error(
          "Sponsored FPC is a contract — turn off auto-claim. Bridge Fee Juice to the FPC address only.",
        );
      }
      const result = await bridgeFromConnectedWallet({
        provider,
        chainId,
        expectedChainId: networkMeta.l1ChainId,
        addresses: networkMeta.l1Addresses,
        aztecRecipient: recipient.trim(),
        amount: amount.wei,
        mint,
        backend,
        l1RpcUrl: networkMeta.l1RpcUrl,
        feeRecipient: BRIDGE_FEE_RECIPIENT as Hex,
        ethServiceFeeWei: BRIDGE_ETH_FEE_WEI_OVERRIDE ?? ethServiceFeeWei ?? undefined,
        onPending: async (pending: PendingBridge) => {
          setL1TxHash(pending.l1TxHash);
          setShowBridgeResult(true);
          void recordHistory({
            networkId,
            kind: "l1-submitted",
            amount: pending.claimAmount,
            recipient: pending.recipient,
            l1TxHash: pending.l1TxHash,
          });
          try {
            await upsertSession(networkId, {
              l1TxHash: pending.l1TxHash,
              phase: "l1-pending",
              recipient: pending.recipient,
              claimAmount: pending.claimAmount,
              pending,
            });
            await refreshSessions();
          } catch (storageError: unknown) {
            downloadJson(`claim-pending-${shortHash(pending.l1TxHash)}.json`, {
              version: 1,
              networkId,
              pending,
            });
            setError(
              `L1 deposit submitted, but browser recovery storage failed: ${storageErrorMessage(
                storageError,
              )}. Keep the downloaded pending-claim backup.`,
            );
          }
        },
        onProgress: (phase: BridgeProgressPhase, detail?: string) => {
          const labels: Record<BridgeProgressPhase, string> = {
            prepare: "Preparing…",
            eth_fee_wallet: "Confirm ETH service fee in wallet…",
            eth_fee_wait: "ETH service fee submitted. Waiting…",
            check_allowance: "Checking token allowance…",
            approve_wallet: "Confirm approve in wallet…",
            approve_wait: "Approve submitted. Waiting for confirmation…",
            mint_wallet: "Confirm faucet mint in wallet…",
            mint_wait: "Mint submitted. Waiting for confirmation…",
            bridge_wallet:
              backend === "portal"
                ? "Confirm L1 deposit in wallet…"
                : mint
                  ? "Confirm mintAndBridge in wallet…"
                  : "Confirm GoBridge tx in wallet…",
            bridge_wait: "Bridge submitted. Waiting for confirmation…",
            parse_receipt: "Parsing L1 deposit event…",
          };
          setBridgePhase(detail ?? labels[phase]);
          setProgress((prev) =>
            advanceProgress(prev, { track: "bridge", stepKey: bridgePhaseStep(phase) }),
          );
        },
      });
      setL1TxHash(result.l1TxHash);
      setCredentials(result.credentials);
      setBridgePhase("Saving claim credentials.");
      setProgress((prev) => advanceProgress(prev, { track: "bridge", stepKey: "saved" }));

      const backupErrors: string[] = [];
      try {
        await upsertSession(networkId, {
          l1TxHash: result.l1TxHash,
          phase: "ready-to-claim",
          recipient: result.credentials.recipient,
          claimAmount: result.credentials.claimAmount,
          credentials: result.credentials,
        });
        await refreshSessions();
      } catch (storageError: unknown) {
        backupErrors.push(
          `credentials could not be saved in this browser: ${storageErrorMessage(storageError)}`,
        );
      }

      try {
        await downloadClaimCredentials(result.credentials.recipient, result.credentials, {
          l1TxHash: result.l1TxHash,
          networkId,
        });
      } catch (downloadError: unknown) {
        backupErrors.push(
          `credentials JSON could not be downloaded: ${storageErrorMessage(downloadError)}`,
        );
      }

      if (backupErrors.length > 0) {
        setError(`L1 bridge completed, but ${backupErrors.join("; ")}`);
      }

      refreshBalancesAfterAction();

      setBridgePhase(
        backupErrors.length > 0
          ? "L1 bridge complete. Keep the recovery data from this browser."
          : "L1 bridge complete. Credentials saved locally and downloaded.",
      );
      setProgress((prev) => finishProgress(prev, "succeeded"));
      void recordHistory({
        networkId,
        kind: "l1-confirmed",
        amount: result.credentials.claimAmount,
        recipient: result.credentials.recipient,
        l1TxHash: result.l1TxHash,
      });
    } catch (e: unknown) {
      endFlowFromError(e);
    } finally {
      setBusy(false);
    }
  }, [
    wallet,
    networkMeta,
    recipient,
    amountFj,
    autoClaim,
    l2Secret,
    dfPxeAccount,
    l1Backend,
    networkId,
    refreshSessions,
    refreshBalancesAfterAction,
    endFlowFromError,
  ]);

  const selectRecoverySession = useCallback(
    async (session: BridgeSessionEntry) => {
      setSelectedRecoveryHash(session.l1TxHash);
      try {
        await setActiveSession(networkId, session.l1TxHash);
      } catch {
        /* vault may be locked — still select in UI */
      }
      setL1TxHash(session.l1TxHash);
      setCredentials(session.credentials ?? null);
      setClaimJobId(session.claimJobId ?? null);
      setClaimStatus(null);
      setL2TxHash(session.l2TxHash ?? null);
      setError(null);
      // The guide card below already headlines the phase — no bottom status line.
      setBridgePhase(null);
      setProgress(null);
      setRecoveryPromptOpen(false);
    },
    [networkId],
  );

  const onClaimCredentialsFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setCredentialsImportError(null);
      setCredentialsImportNotice(null);
      try {
        const parsed = parseClaimCredentialsFile(JSON.parse(await file.text()) as unknown);
        if (parsed.networkId && parsed.networkId !== networkId) {
          throw new Error(
            `These credentials are for network "${parsed.networkId}", but you are on "${networkId}".`,
          );
        }

        const unlocked = await ensureUnlocked("secrets");
        if (!unlocked) {
          throw new Error("Unlock the vault to import claim credentials into this browser.");
        }

        const accounts = await listStoredAztecWallets();
        if (!sessionsForAccounts([{ recipient: parsed.recipient }], accounts).length) {
          throw new Error(unknownAccountClaimMessage(parsed.recipient));
        }

        const sessions = await listIncompleteSessions(networkId);
        const duplicate = sessions.find(
          (session) => normalizeL1TxHash(session.l1TxHash) === parsed.l1TxHash,
        );
        if (duplicate) {
          await selectRecoverySession(duplicate);
          setCredentialsImportNotice(
            `Already in the list — L1 ${shortHash(duplicate.l1TxHash)} is ${phaseLabel(
              duplicate.phase,
            ).toLowerCase()}. Selected it below instead of adding a copy.`,
          );
          return;
        }

        const entry = await upsertSession(networkId, {
          l1TxHash: parsed.l1TxHash,
          phase: "ready-to-claim",
          recipient: parsed.recipient,
          claimAmount: parsed.credentials.claimAmount,
          credentials: parsed.credentials,
        });
        await refreshSessions();
        selectRecoverySession(entry);
        setCredentialsImportNotice(
          `Imported L1 ${shortHash(entry.l1TxHash)}. Claim it with the Aztec account already in this browser.`,
        );
        void recordHistory({
          networkId,
          kind: "claim-imported",
          amount: entry.claimAmount,
          recipient: entry.recipient,
          l1TxHash: entry.l1TxHash,
        });
      } catch (e: unknown) {
        setCredentialsImportError(e instanceof Error ? e.message : String(e));
      }
    },
    [networkId, refreshSessions, selectRecoverySession, ensureUnlocked],
  );

  const retryResumeL1 = useCallback(
    async (session: BridgeSessionEntry) => {
      if (!networkMeta || !session.pending) return;
      setBusy(true);
      setError(null);
      setBridgePhase(`Resuming L1 bridge ${shortHash(session.l1TxHash)}…`);
      setProgress(startProgress("resume-l1", "receipt"));
      try {
        const result = await resumePendingBridge({
          pending: {
            ...session.pending,
            portal: session.pending.portal ?? networkMeta.l1Addresses.feeJuicePortal,
          },
          chainId: networkMeta.l1ChainId,
          l1RpcUrl: networkMeta.l1RpcUrl,
        });
        setProgress((prev) =>
          advanceProgress(prev, { track: "resume-l1", stepKey: "credentials" }),
        );
        await upsertSession(networkId, {
          l1TxHash: result.l1TxHash,
          phase: "ready-to-claim",
          recipient: result.credentials.recipient,
          claimAmount: result.credentials.claimAmount,
          credentials: result.credentials,
          makeActive: false,
        });
        downloadClaimCredentials(result.credentials.recipient, result.credentials, {
          l1TxHash: result.l1TxHash,
          networkId,
        });
        await refreshSessions();
        if (normalizeL1TxHash(session.l1TxHash) === normalizeL1TxHash(selectedRecoveryHash ?? "")) {
          setCredentials(result.credentials);
          setL1TxHash(result.l1TxHash);
        }
        setBridgePhase("L1 bridge recovered. Claim credentials restored.");
        setProgress((prev) => finishProgress(prev, "succeeded"));
        void recordHistory({
          networkId,
          kind: "l1-confirmed",
          amount: result.credentials.claimAmount,
          recipient: result.credentials.recipient,
          l1TxHash: result.l1TxHash,
          detail: "L1 deposit recovered in this browser.",
        });
      } catch (e: unknown) {
        endFlowFromError(e);
      } finally {
        setBusy(false);
      }
    },
    [networkMeta, networkId, refreshSessions, selectedRecoveryHash, endFlowFromError],
  );

  const waitForSessionL2 = useCallback(
    async (session: BridgeSessionEntry) => {
      if (!networkMeta || !session.l2TxHash) return;
      setBusy(true);
      setError(null);
      setBridgePhase(`Waiting for L2 confirmation ${shortHash(session.l2TxHash)}…`);
      setProgress({ ...startProgress("wait-l2", "confirm"), txSubmitted: true });
      try {
        const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
        const { waitForL2ClaimTx } = await loadBrowserClaim();
        await waitForL2ClaimTx({
          aztecNodeUrl: networkMeta.aztecNodeUrl,
          l2TxHash: session.l2TxHash,
        });
        await removeSession(networkId, session.l1TxHash);
        await refreshSessions();
        setBridgePhase(`L2 claim complete. ${session.l2TxHash}`);
        setProgress((prev) => finishProgress(prev, "succeeded"));
        setClaimStatus("succeeded");
        setL2TxHash(session.l2TxHash);
        refreshBalancesAfterAction();
        void recordHistory({
          networkId,
          kind: "claim-confirmed",
          amount: session.claimAmount,
          recipient: session.recipient,
          l1TxHash: session.l1TxHash,
          l2TxHash: session.l2TxHash,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        try {
          await upsertSession(networkId, {
            l1TxHash: session.l1TxHash,
            phase: "claim-sent",
            recipient: session.recipient,
            claimAmount: session.claimAmount,
            credentials: session.credentials,
            l2TxHash: session.l2TxHash,
            lastError: message,
            makeActive: false,
          });
          await refreshSessions();
        } catch {
          /* toast still shows the wait error */
        }
        endFlowFromError(e);
      } finally {
        setBusy(false);
      }
    },
    [networkMeta, networkId, refreshSessions, refreshBalancesAfterAction, endFlowFromError],
  );

  const onResumeClaim = useCallback(
    async (session: BridgeSessionEntry) => {
      if (!session.credentials) return;
      if (!l2Secret.trim()) {
        setError("Enter the Aztec L2 secret to claim.");
        return;
      }
      setL1TxHash(session.l1TxHash);
      setCredentials(session.credentials);
      setBusy(true);
      setError(null);
      try {
        await startClaimJob(
          session.l1TxHash,
          session.credentials,
          l2Secret.trim(),
          l2Salt,
          resolveClaimSigningKey(session.credentials.recipient, l2SigningKey, dfPxeAccount),
          legacyAccountStyles,
        );
      } catch (e: unknown) {
        endFlowFromError(e);
      } finally {
        setBusy(false);
        await refreshSessions();
      }
    },
    [l2Secret, l2Salt, l2SigningKey, dfPxeAccount, legacyAccountStyles, startClaimJob, refreshSessions, endFlowFromError],
  );

  const onRemoveSession = useCallback(
    async (session: BridgeSessionEntry) => {
      await removeSession(networkId, session.l1TxHash);
      await refreshSessions();
      setSelectedRecoveryHash(null);
      setCredentials(null);
      setL1TxHash(null);
      setBridgePhase(null);
      setProgress(null);
      void recordHistory({
        networkId,
        kind: "claim-removed",
        amount: session.claimAmount,
        recipient: session.recipient,
        l1TxHash: session.l1TxHash,
        detail: "Removed from this browser. The Ethereum deposit was not undone.",
      });
    },
    [networkId, refreshSessions],
  );

  const claimAfterBridge = useCallback(async () => {
    if (!credentials || !l1TxHash) {
      setError("Claim credentials are missing. Open Recover to finish the claim.");
      return;
    }
    if (!l2Secret.trim()) {
      setError("Enter the Aztec L2 secret to claim.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startClaimJob(
        l1TxHash,
        credentials,
        l2Secret.trim(),
        l2Salt,
        resolveClaimSigningKey(credentials.recipient, l2SigningKey, dfPxeAccount),
        legacyAccountStyles,
      );
      if (!BROWSER_CLAIM) {
        setBridgePhase("L2 claim job queued. Polling status.");
      }
    } catch (e: unknown) {
      endFlowFromError(e);
    } finally {
      setBusy(false);
    }
  }, [
    credentials,
    l1TxHash,
    l2Secret,
    l2Salt,
    l2SigningKey,
    dfPxeAccount,
    legacyAccountStyles,
    startClaimJob,
    endFlowFromError,
  ]);

  return {
    startClaimJob,
    claimAfterBridge,
    onBridge,
    selectRecoverySession,
    onClaimCredentialsFile,
    retryResumeL1,
    waitForSessionL2,
    onResumeClaim,
    onRemoveSession,
  };
}
