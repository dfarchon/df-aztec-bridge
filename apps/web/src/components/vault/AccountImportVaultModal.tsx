import { ClaimJsonExport } from "./ClaimJsonExport.tsx";
import { useRef, useState } from "react";
import type { ImportedAztecAccount } from "../../lib/account-import.ts";
import type { VaultProfileMeta } from "../../lib/vault-crypto.ts";
import { getVaultSession, isVaultUnlocked, setupVault } from "../../lib/vault.ts";
import { registerVaultPasskey } from "../../lib/vault-passkey.ts";
import { VaultUnlockModal } from "./VaultUnlockModal.tsx";

export function AccountImportVaultModal({ account, existing, onFinish }: {
  account: ImportedAztecAccount;
  existing: VaultProfileMeta | null;
  onFinish: (saved: boolean) => void;
}) {
  const [step, setStep] = useState<"review" | "setup">(existing ? "review" : "setup");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoDownloads = useRef(new Set<string>());
  const [checkingClaims, setCheckingClaims] = useState(!!existing);
  const { address } = account;
  const unlockedHere = isVaultUnlocked() && getVaultSession()?.address.toLowerCase() === address.toLowerCase();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (step === "review") return (
    <div className="modal-backdrop vault-modal-backdrop">
      <section className="modal vault-modal vault-replace-modal" role="dialog" aria-modal="true" aria-labelledby="replace-vault-title">
        <h2 id="replace-vault-title">Replace this wallet’s local vault?</h2>
        <div className="vault-replace-body">
          <p className="mono small vault-modal-addr">{address}</p>
          <p>Saving a new password permanently replaces this wallet’s encrypted data in this browser.
            Saved claims download automatically before you continue.</p>
          <ClaimJsonExport key={String(unlockedHere)} address={address} account={account} unlocked={unlockedHere} disabled={busy}
            autoDownloads={autoDownloads.current} onChecking={setCheckingClaims} />
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="vault-replace-actions">
          <button disabled={busy || checkingClaims} onClick={() => { setError(null); setStep("setup"); }}>
            Continue to new vault
          </button>
          <button disabled={busy} onClick={() => onFinish(false)}>Cancel import</button>
        </div>
      </section>
    </div>
  );

  return <VaultUnlockModal open mode="setup" aztecAddress={address} busy={busy}
    error={error} replacingVault={!!existing}
    onCancel={() => {
      if (!existing) return onFinish(false);
      setError(null);
      setCheckingClaims(true);
      setStep("review");
    }}
    onSubmit={(password, opts) => run(async () => {
      const passkey = opts.registerPasskey ? await registerVaultPasskey({ aztecAddress: address }) : null;
      await setupVault({
        aztecAddress: address, password, passkey: passkey?.meta, prfSecret: passkey?.prfSecret,
        imported: { expectedSalt: existing?.salt ?? null, wallets: { accounts: [account], activeAddress: address } },
      });
      onFinish(true);
    })} />;
}
