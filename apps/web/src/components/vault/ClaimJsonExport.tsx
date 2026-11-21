import { DfAccountDropZone } from "../ui/DfAccountDropZone.tsx";
import { useEffect, useRef, useState } from "react";
import { readVaultClaimsForExport } from "../../lib/bridge-session.ts";
import { listPreparedDeposits } from "../../lib/prepared-deposit.ts";
import { readAccountFile, type ImportedAztecAccount } from "../../lib/account-import.ts";
import { downloadClaimCredentials, downloadJson } from "../../lib/claim-credentials-store.ts";
import { exportableClaimId, type ExportableClaim } from "../../lib/claim-copy.ts";
import { claimExportAvailability, recoverClaimsWithAccount } from "../../lib/vault.ts";

async function download(claim: ExportableClaim) {
  if (claim.prepared) return downloadJson(`claim-prepared-${claim.prepared.deposit.claimSecretHash.slice(2, 14)}.json`, claim.prepared);
  const { credentials, pending, networkId, l1TxHash } = claim;
  if (credentials) return downloadClaimCredentials(credentials.recipient, credentials, { networkId, l1TxHash });
  if (pending) return downloadJson(`claim-pending-${l1TxHash}.json`, { version: 1, networkId, pending });
}

async function readUnlockedClaims(address: string): Promise<ExportableClaim[]> {
  const entries = await readVaultClaimsForExport(address);
  const prepared = await listPreparedDeposits();
  return [...entries, ...prepared.map(file => ({ networkId: file.networkId, prepared: file }))];
}

export function ClaimJsonExport({ address, account, disabled, unlocked, autoDownloads, onChecking }: {
  address: string;
  account?: ImportedAztecAccount;
  disabled?: boolean;
  unlocked?: boolean;
  /** Kept by the import dialog across the review and password steps. */
  autoDownloads?: Set<string>;
  onChecking?: (checking: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [claims, setClaims] = useState<ExportableClaim[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [availability, setAvailability] = useState<Awaited<ReturnType<typeof claimExportAvailability>> | "checking" | "error">("checking");
  useEffect(() => {
    let current = true;
    setAvailability("checking");
    onChecking?.(true);
    async function check() {
      const entries = unlocked ? await readUnlockedClaims(address) : null;
      const result = entries
        ? entries.length ? "available" : "empty"
        : await claimExportAvailability(address, account);
      if (!current) return;
      setAvailability(result);
      if (result !== "available" || !account || !autoDownloads) return;
      setBusy(true);
      const recovered = entries ?? await recoverClaimsWithAccount(address, account);
      if (!current) return;
      setClaims(recovered);
      if (!recovered.length) {
        setAvailability("empty");
        return;
      }
      let failed = false;
      for (const claim of recovered) {
        if (!current) return;
        const id = exportableClaimId(claim);
        if (autoDownloads.has(id)) continue;
        autoDownloads.add(id);
        try {
          await download(claim);
        } catch {
          autoDownloads.delete(id);
          failed = true;
        }
      }
      if (current) setNotice(failed
        ? "Some downloads could not start. Use Export claims to retry before replacing the vault."
        : "Check your downloads before replacing the vault. Use Export claims again if any file is missing.");
    }
    void check().catch(cause => {
      if (!current) return;
      setAvailability(previous => previous === "available" ? previous : "error");
      setNotice(cause instanceof Error ? cause.message : "Could not check saved claims.");
    }).finally(() => {
      if (current) {
        setBusy(false);
        onChecking?.(false);
      }
    });
    return () => { current = false; };
  }, [address, account, unlocked, autoDownloads, onChecking]);

  async function recover(file?: File) {
    setBusy(true);
    onChecking?.(true);
    setNotice("");
    setClaims([]);
    try {
      const original = file
        ? (await readAccountFile(file)).find(a => a.address.toLowerCase() === address.toLowerCase())
        : account;
      if (!original) throw new Error("Choose the original account JSON for this wallet.");
      const recovered = unlocked ? await readUnlockedClaims(address) : await recoverClaimsWithAccount(address, original);
      setClaims(recovered);
      if (!recovered.length) setAvailability("empty");
      if (recovered.length && (account || recovered.length === 1)) {
        for (const claim of recovered) await download(claim);
        setNotice("Check your downloads for the claim JSON files. Keep them private.");
      } else {
        setNotice(recovered.length ? "Choose the claims to download. Keep the files private." : "No saved claims in this vault.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      onChecking?.(false);
    }
  }
  if (availability === "empty" || availability === "checking") return null;
  if (availability === "needs-unlock") return <p className="hint">Unlock this vault once to prepare its claim recovery copies.</p>;
  if (availability === "error") return <p role="alert">{notice || "Could not check saved claims. Verify the wallet and try again."}</p>;
  return <div className="vault-claim-export">
    {account ? (
      <button type="button" disabled={disabled || busy} onClick={() => void recover()}>
        {busy ? "Reading claim copies…" : "Export claims"}
      </button>
    ) : (
      <DfAccountDropZone
        disabled={!!disabled || busy}
        label={busy ? "Reading claim copies…" : availability === "unknown" ? "Check for claims with account JSON" : "Export claims with account JSON"}
        onChoose={() => fileInput.current?.click()}
        onFiles={files => {
          if (files.length === 1) void recover(files[0]);
          else setNotice("Choose one account JSON file.");
        }}
      />
    )}
    {!account && <input hidden type="file" accept=".json,application/json" ref={fileInput} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void recover(file);
    }} />}
    {notice && <p className="hint" role="status">{notice}</p>}
    {claims.length > 0 && <div className="vault-claim-downloads" role="group" aria-label="Claim downloads">
      {claims.map(claim => <button type="button" key={exportableClaimId(claim)}
        disabled={disabled || busy} onClick={() => void download(claim).catch(() => setNotice("Download failed. Try again."))}>
        Download claim · {claim.networkId} · {(claim.l1TxHash ?? claim.prepared.deposit.claimSecretHash).slice(0, 12)}
      </button>)}
    </div>}
  </div>;
}
