import type { PreparedDeposit } from "@df-bridge/browser-sdk";
import { currentVaultGuard, vaultDeleteJson, vaultGetJson, vaultListDocs, vaultSetJson } from "./vault.ts";

export interface PreparedDepositFile {
  format: "df-bridge-prepared-deposit-v1";
  networkId: string;
  deposit: PreparedDeposit;
}

export function preparedDepositId(hash: string) {
  return "deposit:" + hash.toLowerCase().slice(2);
}

export function parsePreparedDeposit(value: unknown): PreparedDepositFile {
  const file = value as Partial<PreparedDepositFile> | null;
  const d = file?.deposit;
  if (file?.format !== "df-bridge-prepared-deposit-v1" || typeof file.networkId !== "string" || !d ||
      !Number.isSafeInteger(d.chainId) || d.chainId <= 0 ||
      typeof d.fromBlock !== "string" || !/^\d{1,20}$/.test(d.fromBlock) ||
      typeof d.claimAmount !== "string" || !/^\d{1,78}$/.test(d.claimAmount) ||
      !/^0x[\da-f]{40}$/i.test(d.portal) || !/^0x[\da-f]{1,64}$/i.test(d.recipient) ||
      !/^0x[\da-f]{64}$/i.test(d.claimSecret) || !/^0x[\da-f]{64}$/i.test(d.claimSecretHash)) {
    throw new Error("Invalid prepared deposit backup.");
  }
  const { chainId, fromBlock, portal, recipient, claimAmount, claimSecret, claimSecretHash } = d;
  return { format: file.format, networkId: file.networkId,
    deposit: { chainId, fromBlock, portal, recipient, claimAmount, claimSecret, claimSecretHash } };
}

export async function savePreparedDeposit(networkId: string, deposit: PreparedDeposit) {
  const file = parsePreparedDeposit({ format: "df-bridge-prepared-deposit-v1", networkId, deposit });
  const id = preparedDepositId(deposit.claimSecretHash);
  const guard = currentVaultGuard();
  const existing = await vaultGetJson(id);
  guard();
  if (existing) {
    if (JSON.stringify(parsePreparedDeposit(existing)) !== JSON.stringify(file)) {
      throw new Error("A different preparation for this deposit is already saved.");
    }
    return;
  }
  await vaultSetJson(id, file);
}

export async function listPreparedDeposits(networkId?: string) {
  const guard = currentVaultGuard();
  const files: PreparedDepositFile[] = [];
  for (const id of await vaultListDocs()) {
    if (!id.startsWith("deposit:")) continue;
    guard();
    const value = await vaultGetJson(id);
    if (!value) continue;
    const file = parsePreparedDeposit(value);
    if (!networkId || file.networkId === networkId) files.push(file);
  }
  guard();
  return files;
}

export function removePreparedDeposit(hash: string) {
  return vaultDeleteJson(preparedDepositId(hash));
}
