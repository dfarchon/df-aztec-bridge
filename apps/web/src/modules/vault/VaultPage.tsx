import { useCallback, useEffect, useState } from "react";
import type { BridgeSessionEntry } from "../../lib/bridge-session.ts";
import {
  loadSessionStore,
  normalizeL1TxHash,
} from "../../lib/bridge-session.ts";
import { listStoredAztecWallets } from "../../lib/aztec-wallet-store.ts";
import { phaseLabel, shortHash } from "../../lib/claim-recovery.ts";
import { formatFjAmount } from "../../lib/bridge-amount.ts";
import { listHistory } from "../../lib/operation-history.ts";
import { getRpcOverrides } from "../../lib/rpc-overrides.ts";
import { getNetwork, l1ChainLabel, listNetworkIds } from "../../config/networks.ts";
import { useNetwork } from "../../providers/NetworkProvider.tsx";
import { ROUTES } from "../../app/routes.ts";
import { useNavigate } from "../../app/router.tsx";
import { useVault } from "../../providers/VaultProvider.tsx";
import {
  downloadJsonFile,
  getVaultProfile,
  isVaultUnlocked,
  vaultExportAllJson,
  vaultImportEncryptedBackup,
  vaultListDocs,
} from "../../lib/vault.ts";

type Pane =
  | "locked"
  | "overview"
  | "account"
  | "claims"
  | "claim-detail"
  | "nodes"
  | "backup";

type NodeRow = {
  networkId: string;
  networkName: string;
  effectiveAztecUrl: string;
  l1RpcUrl: string;
  l1ChainId: number;
  usesVaultOverride: boolean;
  isActiveNetwork: boolean;
};

type VaultSnapshot = {
  accountAddress: string | null;
  accountSavedAt: number | null;
  passkeyEnabled: boolean;
  pxeRegistered: boolean;
  boundEthAddress: string | null;
  claimCount: number;
  claims: BridgeSessionEntry[];
  historyCount: number;
  nodeRows: NodeRow[];
};

const EMPTY_SNAPSHOT: VaultSnapshot = {
  accountAddress: null,
  accountSavedAt: null,
  passkeyEnabled: false,
  pxeRegistered: false,
  boundEthAddress: null,
  claimCount: 0,
  claims: [],
  historyCount: 0,
  nodeRows: [],
};

function formatSavedAt(value: number | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

function sessionAmountFj(amount: string): string {
  try {
    return formatFjAmount(BigInt(amount), 5);
  } catch {
    return amount;
  }
}

function bridgeDocNetworkId(docId: string): string | null {
  if (!docId.startsWith("bridge:")) return null;
  const rest = docId.slice("bridge:".length);
  if (!rest || rest.endsWith(":legacy-v1")) return null;
  return rest;
}

function nodeOverviewHint(rows: NodeRow[]): string {
  const current = rows.find((row) => row.isActiveNetwork);
  if (!current) return "View per-network RPC";
  const kind = current.usesVaultOverride ? "Custom" : "Default";
  return `${kind} · ${current.networkName}`;
}

async function loadVaultSnapshot(activeNetworkId: string): Promise<VaultSnapshot> {
  if (!isVaultUnlocked()) return EMPTY_SNAPSHOT;

  const accounts = await listStoredAztecWallets();
  const account = accounts[0] ?? null;
  const profile = account ? await getVaultProfile(account.address) : null;

  const docIds = await vaultListDocs();
  const bridgeIds = docIds
    .map(bridgeDocNetworkId)
    .filter((id): id is string => !!id);

  const claimMap = new Map<string, BridgeSessionEntry>();
  for (const networkId of bridgeIds) {
    const store = await loadSessionStore(networkId);
    for (const entry of Object.values(store.sessions)) {
      if (entry.networkId !== networkId) continue;
      claimMap.set(normalizeL1TxHash(entry.l1TxHash), entry);
    }
  }
  const claims = [...claimMap.values()].sort((a, b) => b.updatedAt - a.updatedAt);

  const nodeRows: NodeRow[] = [];
  for (const networkId of listNetworkIds()) {
    const defaults = getNetwork(networkId);
    const override = await getRpcOverrides(networkId);
    const overrideUrl = override.aztecNodeUrl?.trim();
    nodeRows.push({
      networkId,
      networkName: defaults.name,
      effectiveAztecUrl: overrideUrl || defaults.aztecNodeUrl,
      l1RpcUrl: defaults.l1RpcUrl,
      l1ChainId: defaults.l1ChainId,
      usesVaultOverride: !!overrideUrl,
      isActiveNetwork: networkId === activeNetworkId,
    });
  }

  const history = await listHistory();

  return {
    accountAddress: account?.address ?? null,
    accountSavedAt: account?.createdAt ?? profile?.createdAt ?? null,
    passkeyEnabled: !!profile?.passkey,
    pxeRegistered: !!account?.pxeRegistered,
    boundEthAddress: account?.boundEthAddress ?? null,
    claimCount: claims.length,
    claims,
    historyCount: history.length,
    nodeRows,
  };
}

export function VaultPage() {
  const navigate = useNavigate();
  const { networkId } = useNetwork();
  const {
    unlocked,
    pxeAccount,
    address: vaultAddress,
    vaultAvailable,
    lock,
    requestUnlock,
    secretsVisible,
  } = useVault();

  const [pane, setPane] = useState<Pane>("locked");
  const [snapshot, setSnapshot] = useState<VaultSnapshot>(EMPTY_SNAPSHOT);
  const [selectedClaimKey, setSelectedClaimKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isVaultUnlocked()) {
      setSnapshot(EMPTY_SNAPSHOT);
      setSelectedClaimKey(null);
      return;
    }
    try {
      setSnapshot(await loadVaultSnapshot(networkId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [networkId]);

  useEffect(() => {
    void refresh();
  }, [refresh, unlocked, networkId]);

  useEffect(() => {
    if (!secretsVisible || !unlocked) {
      setPane("locked");
      setSelectedClaimKey(null);
      return;
    }
    setPane((prev) => {
      if (prev === "locked" || prev === "backup") return "overview";
      return prev;
    });
  }, [secretsVisible, unlocked]);

  const selectedClaim =
    snapshot.claims.find(
      (entry) => normalizeL1TxHash(entry.l1TxHash) === selectedClaimKey,
    ) ?? null;

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const all = await vaultExportAllJson();
      const addr =
        pxeAccount?.address?.slice(0, 10) ??
        vaultAddress?.slice(0, 10) ??
        snapshot.accountAddress?.slice(0, 10) ??
        "vault";
      downloadJsonFile(`df-bridge-vault-${addr}-${Date.now()}.json`, all);
      setPane("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onImportBackup = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const count = await vaultImportEncryptedBackup(parsed);
      await refresh();
      setError(null);
      setPane("overview");
      if (count === 0) setError("Backup file had no documents.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openClaim = (entry: BridgeSessionEntry) => {
    setSelectedClaimKey(normalizeL1TxHash(entry.l1TxHash));
    setPane("claim-detail");
  };

  const backToOverview = () => {
    setSelectedClaimKey(null);
    setPane("overview");
  };

  return (
    <div className="bridge-layout recover-layout vault-layout" aria-label="Vault">
      <section className="bridge-step">
        {pane === "locked" ? (
          <>
            <p className="wallet-manager-pane-title">Saved on this device</p>
            <p className="hint">
              Your Aztec account and unfinished claims stay encrypted in this browser. Unlock with
              your vault password. After about 15 minutes idle, or 5 minutes with this tab hidden,
              the vault locks again.
            </p>
            {!vaultAvailable && !pxeAccount ? (
              <p className="hint">
                No vault yet. Open <strong>Wallets</strong> (top right), import your Aztec account,
                then set a vault password.
              </p>
            ) : (
              <button type="button" onClick={requestUnlock}>
                Unlock vault
              </button>
            )}
          </>
        ) : null}

        {pane === "overview" ? (
          <>
            <p className="wallet-manager-pane-title">What&apos;s saved here</p>
            <p className="hint">
              This page summarizes encrypted data in this browser. Private keys and claim secrets are
              never shown here.
            </p>
            <ul className="recovery-session-list">
              <li>
                <button
                  type="button"
                  className="recovery-session-item"
                  onClick={() => setPane("account")}
                >
                  <span className="recovery-session-amount">Aztec account</span>
                  <span className="hint">
                    {snapshot.accountAddress
                      ? `${shortHash(snapshot.accountAddress)}${
                          formatSavedAt(snapshot.accountSavedAt)
                            ? ` · saved ${formatSavedAt(snapshot.accountSavedAt)}`
                            : ""
                        }`
                      : "None saved yet"}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="recovery-session-item"
                  onClick={() => setPane("claims")}
                >
                  <span className="recovery-session-amount">Unfinished claims</span>
                  <span className="hint">
                    {snapshot.claimCount === 0
                      ? "None"
                      : `${snapshot.claimCount} saved in this browser`}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="recovery-session-item"
                  onClick={() => setPane("nodes")}
                >
                  <span className="recovery-session-amount">Aztec node</span>
                  <span className="hint">{nodeOverviewHint(snapshot.nodeRows)}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="recovery-session-item"
                  onClick={() => navigate(ROUTES.history)}
                >
                  <span className="recovery-session-amount">Activity</span>
                  <span className="hint">
                    {snapshot.historyCount === 0
                      ? "No operations yet"
                      : `${snapshot.historyCount} event${
                          snapshot.historyCount === 1 ? "" : "s"
                        } · open History`}
                  </span>
                </button>
              </li>
            </ul>
            <div className="recovery-actions">
              <button type="button" className="ghost" onClick={() => lock()}>
                Lock
              </button>
              <button type="button" onClick={() => setPane("backup")}>
                Download a backup
              </button>
            </div>
          </>
        ) : null}

        {pane === "account" ? (
          <>
            <p className="wallet-manager-pane-title">Aztec account</p>
            {snapshot.accountAddress ? (
              <>
                <p className="hint">{shortHash(snapshot.accountAddress)}</p>
                {formatSavedAt(snapshot.accountSavedAt) ? (
                  <p className="hint">Saved {formatSavedAt(snapshot.accountSavedAt)}</p>
                ) : null}
                <p className="hint">
                  Passkey: {snapshot.passkeyEnabled ? "On" : "Off"}
                </p>
                <p className="hint">
                  Registered on this browser: {snapshot.pxeRegistered ? "Yes" : "Not yet"}
                </p>
                {snapshot.boundEthAddress ? (
                  <p className="hint">
                    Linked Ethereum wallet: {shortHash(snapshot.boundEthAddress)}
                  </p>
                ) : null}
                <p className="hint">
                  Account keys are stored encrypted in this vault. This page never displays them.
                </p>
              </>
            ) : (
              <p className="hint">
                No Aztec account is saved yet. Import one from Wallets, then unlock the vault.
              </p>
            )}
            <button type="button" className="ghost" onClick={backToOverview}>
              Back
            </button>
          </>
        ) : null}

        {pane === "claims" ? (
          <>
            <p className="wallet-manager-pane-title">Unfinished claims</p>
            {snapshot.claims.length === 0 ? (
              <p className="hint">
                Nothing waiting to claim. After an L1 deposit, unfinished claims show up here and on
                Recover.
              </p>
            ) : (
              <ul className="recovery-session-list">
                {snapshot.claims.map((entry) => {
                  const key = normalizeL1TxHash(entry.l1TxHash);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="recovery-session-item"
                        onClick={() => openClaim(entry)}
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
            )}
            <button type="button" className="ghost" onClick={backToOverview}>
              Back
            </button>
          </>
        ) : null}

        {pane === "claim-detail" && selectedClaim ? (
          <>
            <p className="wallet-manager-pane-title">Unfinished claim</p>
            <p className="hint">
              {sessionAmountFj(selectedClaim.claimAmount)} FJ →{" "}
              {shortHash(selectedClaim.recipient)}
            </p>
            <p className="hint">{phaseLabel(selectedClaim.phase)}</p>
            {selectedClaim.updatedAt ? (
              <p className="hint">Updated {formatUpdatedAt(selectedClaim.updatedAt)}</p>
            ) : null}
            <p className="hint">
              Claim credentials stay encrypted in this vault. Use Recover to continue this claim.
            </p>
            <div className="recovery-actions">
              <button type="button" onClick={() => navigate(ROUTES.recover)}>
                Open Recover
              </button>
              <button type="button" className="ghost" onClick={() => setPane("claims")}>
                Back to claims
              </button>
            </div>
          </>
        ) : null}

        {pane === "nodes" ? (
          <>
            <p className="wallet-manager-pane-title">RPC in use</p>
            <p className="hint">
              Same URLs Bridge uses after merging app defaults with anything saved in this vault.
              Change Aztec nodes from RPC settings on Bridge.
            </p>
            <ul className="recovery-session-list vault-node-list">
              {snapshot.nodeRows.map((row) => (
                <li key={row.networkId}>
                  <div className="recovery-session-item recovery-session-item-static vault-node-card">
                    <span className="recovery-session-amount">
                      {row.networkName}
                      {row.isActiveNetwork ? " · current network" : ""}
                    </span>
                    <span className="hint">
                      Aztec node · {row.usesVaultOverride ? "Custom" : "Default"}
                    </span>
                    <p className="rpc-using-url">{row.effectiveAztecUrl}</p>
                    <span className="hint">
                      L1 ({l1ChainLabel(row.l1ChainId)}) · {row.l1RpcUrl}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className="ghost" onClick={backToOverview}>
              Back
            </button>
          </>
        ) : null}

        {pane === "backup" ? (
          <div className="df-pxe-format-pane">
            <p className="wallet-manager-pane-title">Download a backup</p>
            <p className="hint">
              The file is vault ciphertext. Account keys are not readable in it. Restore it here
              with the same vault password, and keep the file offline.
            </p>
            <button type="button" disabled={busy} onClick={() => void onExport()}>
              {busy ? "Working…" : "Download encrypted backup"}
            </button>
            <label className="hint">
              Restore an encrypted backup
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onImportBackup(file);
                }}
              />
            </label>
            <button type="button" className="ghost" onClick={backToOverview}>
              Cancel
            </button>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  );
}
