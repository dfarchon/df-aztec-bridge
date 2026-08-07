/**
 * Aztec (dfpunk) wallets persisted as encrypted JSON in the password vault.
 */

import type { ImportedAztecAccount } from "./account-import.ts";
import {
  isVaultUnlocked,
  vaultGetJson,
  vaultSetJson,
  type VaultWalletsDoc,
  VaultLockedError,
} from "./vault.ts";

function emptyDoc(): VaultWalletsDoc {
  return { accounts: [], activeAddress: null };
}

async function readDoc(): Promise<VaultWalletsDoc> {
  if (!isVaultUnlocked()) return emptyDoc();
  const doc = await vaultGetJson<VaultWalletsDoc>("wallets");
  if (!doc || !Array.isArray(doc.accounts)) return emptyDoc();
  return {
    accounts: doc.accounts,
    activeAddress: doc.activeAddress ?? null,
  };
}

async function writeDoc(doc: VaultWalletsDoc): Promise<void> {
  if (!isVaultUnlocked()) throw new VaultLockedError();
  await vaultSetJson("wallets", doc);
}

function asAccounts(raw: unknown[]): ImportedAztecAccount[] {
  return raw.filter(
    (a): a is ImportedAztecAccount =>
      !!a &&
      typeof a === "object" &&
      typeof (a as ImportedAztecAccount).address === "string" &&
      typeof (a as ImportedAztecAccount).secretKey === "string" &&
      typeof (a as ImportedAztecAccount).salt === "string",
  );
}

export async function listStoredAztecWallets(): Promise<ImportedAztecAccount[]> {
  const doc = await readDoc();
  return asAccounts(doc.accounts).sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
}

export async function saveAztecWallet(account: ImportedAztecAccount): Promise<void> {
  const doc = await readDoc();
  const accounts = asAccounts(doc.accounts);
  const idx = accounts.findIndex(
    (a) => a.address.toLowerCase() === account.address.toLowerCase(),
  );
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  await writeDoc({ accounts, activeAddress: account.address });
}

export async function removeAztecWallet(address: string): Promise<void> {
  const doc = await readDoc();
  const accounts = asAccounts(doc.accounts).filter(
    (a) => a.address.toLowerCase() !== address.toLowerCase(),
  );
  const active =
    doc.activeAddress?.toLowerCase() === address.toLowerCase()
      ? null
      : doc.activeAddress;
  await writeDoc({ accounts, activeAddress: active });
}

export async function setActiveAztecWallet(address: string): Promise<void> {
  const doc = await readDoc();
  await writeDoc({ ...doc, accounts: asAccounts(doc.accounts), activeAddress: address });
}

export async function getActiveAztecWallet(): Promise<string | null> {
  const doc = await readDoc();
  return doc.activeAddress;
}

export async function getStoredAztecWallet(
  address: string,
): Promise<ImportedAztecAccount | null> {
  const accounts = await listStoredAztecWallets();
  return (
    accounts.find((a) => a.address.toLowerCase() === address.toLowerCase()) ?? null
  );
}
