/**
 * Human-readable wallet backup (.txt) — KEY=value lines.
 * Also accepts JSON (dfpunk-account) for import convenience.
 */

import type { ImportedAztecAccount } from "./account-import.ts";
import { parseAccountUpload } from "./account-import.ts";

export type EthWalletBackup = {
  type: "ethereum-connected";
  address: string;
  chainId: number;
  walletName?: string;
  networkId?: string;
  exportedAt: string;
};

export type AztecWalletBackup = {
  type: "dfpunk-aztec";
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  createdAt?: number;
  label?: string;
  networkId?: string;
  exportedAt: string;
};

function line(key: string, value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  return `${key}=${value}`;
}

export function serializeAztecWalletTxt(
  account: ImportedAztecAccount,
  extras?: { networkId?: string },
): string {
  const exportedAt = new Date().toISOString();
  return [
    "# DF Aztec Bridge — Aztec (dfpunk) wallet backup",
    "# KEEP THIS FILE SECRET. Anyone with these keys controls the account.",
    "# Compatible with dfpunk-account JSON fields.",
    line("type", "dfpunk-aztec"),
    line("exportedAt", exportedAt),
    line("networkId", extras?.networkId),
    line("label", account.label),
    line("address", account.address),
    line("secretKey", account.secretKey),
    line("salt", account.salt),
    line("signingKey", account.signingKey),
    line("createdAt", account.createdAt),
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function serializeEthWalletTxt(backup: Omit<EthWalletBackup, "type" | "exportedAt">): string {
  const exportedAt = new Date().toISOString();
  return [
    "# DF Aztec Bridge — Ethereum connected wallet snapshot",
    "# Address only (MetaMask / EIP-1193 does not export private keys).",
    line("type", "ethereum-connected"),
    line("exportedAt", exportedAt),
    line("networkId", backup.networkId),
    line("walletName", backup.walletName),
    line("chainId", backup.chainId),
    line("address", backup.address),
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function parseTxtMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function parseAztecWalletTxt(text: string): ImportedAztecAccount {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseAccountUpload(JSON.parse(trimmed) as unknown)[0]!;
  }
  const m = parseTxtMap(trimmed);
  if (!m.address || !m.secretKey || !m.salt) {
    throw new Error(
      "TXT backup missing address / secretKey / salt. Use a dfpunk Aztec backup or JSON account file.",
    );
  }
  return {
    address: m.address,
    secretKey: m.secretKey,
    salt: m.salt,
    signingKey: m.signingKey || undefined,
    createdAt: m.createdAt ? Number(m.createdAt) : undefined,
    label: m.label || "imported txt backup",
  };
}

export function serializeAztecWalletJson(account: ImportedAztecAccount): {
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  createdAt?: number;
} {
  if (!account.signingKey?.trim()) {
    throw new Error("Account is missing signingKey — cannot export a DF JSON backup.");
  }
  return {
    address: account.address,
    secretKey: account.secretKey,
    salt: account.salt,
    signingKey: account.signingKey,
    ...(typeof account.createdAt === "number" ? { createdAt: account.createdAt } : {}),
  };
}

export function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJsonBackup(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function aztecBackupFilename(address: string): string {
  const short = address.replace(/^0x/i, "").slice(0, 10);
  return `dfpunk-wallet-${short}.txt`;
}

export function aztecBackupJsonFilename(address: string): string {
  const short = address.replace(/^0x/i, "").slice(0, 10);
  return `dfpunk-account-${short}.json`;
}

export function ethBackupFilename(address: string): string {
  const short = address.replace(/^0x/i, "").slice(0, 8);
  return `eth-wallet-${short}.txt`;
}
