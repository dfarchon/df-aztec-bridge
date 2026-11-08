/**
 * Shared DF Punk → PXE registration (TypeScript only).
 * Used by WalletManagerPanel and the connect-session gate.
 */

import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import {
  accountFromV6Wallet,
  assertDfClientAccount,
  readAccountFile,
  type ImportedAztecAccount,
} from "./account-import.ts";
import { tryValidateConnectedWalletSession } from "./wallet-session-guard.ts";
import { withVerifiedV6Address } from "./wallet-backup.ts";
import { pushDappLog } from "./dapp-log.ts";

export type DfPxeImportProgress = (detail: string) => void;

/** Register an already-parsed DF Punk account (from file or vault restore) into browser PXE. */
export async function registerDfPunkAccountIntoPxe(opts: {
  account: ImportedAztecAccount;
  ethWallet: ConnectedWallet;
  networkId: string;
  aztecNodeUrl: string;
  onProgress?: DfPxeImportProgress;
}): Promise<ImportedAztecAccount> {
  const live = await tryValidateConnectedWalletSession(opts.ethWallet);
  if (!live.ok) throw new Error(live.reason);

  const primary = opts.account;
  assertDfClientAccount(primary);
  if (!primary.fromDfClient) {
    throw new Error("Account is not a DF / dfpunk client export.");
  }
  if (!primary.signingKey?.trim()) {
    throw new Error(
      "DF Punk account is missing signingKey — import the full dfpunk-account-*.json from DF client “Download account info”.",
    );
  }

  const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
  const { importDfpunkAccountIntoPxe, warmupBrowserClaim } = await loadBrowserClaim();

  await warmupBrowserClaim({
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    onProgress: (detail) => {
      opts.onProgress?.(detail);
      pushDappLog({ kind: "info", title: "PXE", detail, ttlMs: 6_000 });
    },
  });

  const registered = await importDfpunkAccountIntoPxe({
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    address: primary.address,
    secretKey: primary.secretKey,
    salt: primary.salt,
    signingKey: primary.signingKey,
    onProgress: (_phase, detail) => {
      if (detail) {
        opts.onProgress?.(detail);
        pushDappLog({ kind: "info", title: "DF Punk → PXE", detail, ttlMs: 6_000 });
      }
    },
  });

  return {
    ...primary,
    fromDfClient: true,
    pxeRegistered: true,
    pxeRegisteredAt: Date.now(),
    boundEthAddress: live.wallet.address.toLowerCase(),
    label: primary.label ?? "DF / dfpunk account",
    walletCompat: registered.walletCompat,
  };
}

/** Create a DF-compatible Schnorr initializerless account and register it in PXE. */
export async function createV6PxeAccount(opts: {
  ethWallet: ConnectedWallet;
  networkId: string;
  aztecNodeUrl: string;
  onProgress?: DfPxeImportProgress;
}): Promise<ImportedAztecAccount> {
  const live = await tryValidateConnectedWalletSession(opts.ethWallet);
  if (!live.ok) throw new Error(live.reason);

  const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
  const { createQuickDfpunkAccount, warmupBrowserClaim } = await loadBrowserClaim();

  await warmupBrowserClaim({
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    onProgress: (detail) => {
      opts.onProgress?.(detail);
      pushDappLog({ kind: "info", title: "PXE", detail, ttlMs: 6_000 });
    },
  });

  const created = await createQuickDfpunkAccount({
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    label: "DF Aztec account",
    onProgress: (_phase, detail) => {
      if (!detail) return;
      opts.onProgress?.(detail);
      pushDappLog({ kind: "info", title: "DF Aztec account", detail, ttlMs: 6_000 });
    },
  });

  return accountFromV6Wallet(created, live.wallet.address);
}

/**
 * Check a v5 / v5.1 Schnorr backup against Aztec 6.0.
 * The returned account keeps secretKey, salt, and signingKey and replaces only the address.
 */
export async function verifyPreV6AccountOnV6(opts: {
  account: ImportedAztecAccount;
  ethWallet: ConnectedWallet;
  networkId: string;
  aztecNodeUrl: string;
  onProgress?: DfPxeImportProgress;
}): Promise<ImportedAztecAccount> {
  const live = await tryValidateConnectedWalletSession(opts.ethWallet);
  if (!live.ok) throw new Error(live.reason);

  const primary = opts.account;
  assertDfClientAccount(primary);
  if (!primary.signingKey?.trim()) {
    throw new Error(
      "DF Punk account is missing signingKey — import the full dfpunk-account-*.json from DF client “Download account info”.",
    );
  }

  const { loadBrowserClaim } = await import("@df-bridge/browser-sdk/claim-lazy");
  const { deriveVerifiedV6DfpunkAccount, warmupBrowserClaim } = await loadBrowserClaim();

  await warmupBrowserClaim({
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    onProgress: (detail) => {
      opts.onProgress?.(detail);
      pushDappLog({ kind: "info", title: "PXE", detail, ttlMs: 6_000 });
    },
  });

  const verified = await deriveVerifiedV6DfpunkAccount({
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    address: primary.address,
    secretKey: primary.secretKey,
    salt: primary.salt,
    signingKey: primary.signingKey,
    onProgress: (_phase, detail) => {
      if (!detail) return;
      opts.onProgress?.(detail);
      pushDappLog({ kind: "info", title: "Aztec 6.0 address", detail, ttlMs: 8_000 });
    },
  });

  const rebased = withVerifiedV6Address(primary, verified.address);
  if (
    rebased.secretKey !== primary.secretKey ||
    rebased.salt !== primary.salt ||
    rebased.signingKey !== primary.signingKey
  ) {
    throw new Error("Refusing to save a backup that changed the keys.");
  }

  return {
    ...rebased,
    fromDfClient: true,
    pxeRegistered: true,
    pxeRegisteredAt: Date.now(),
    boundEthAddress: live.wallet.address.toLowerCase(),
    label: primary.label ?? "DF Aztec account",
    walletCompat: "v6-initializerless",
  };
}

export async function importDfPunkFileIntoPxe(opts: {
  file: File;
  ethWallet: ConnectedWallet;
  networkId: string;
  aztecNodeUrl: string;
  onProgress?: DfPxeImportProgress;
}): Promise<ImportedAztecAccount> {
  const live = await tryValidateConnectedWalletSession(opts.ethWallet);
  if (!live.ok) throw new Error(live.reason);

  opts.onProgress?.(`Validating connector + reading DF export ${opts.file.name}…`);
  const accounts = await readAccountFile(opts.file);
  const primary = accounts[0];
  if (!primary) throw new Error("No account found in file.");
  assertDfClientAccount(primary);
  if (!primary.fromDfClient) {
    throw new Error("File is not a DF / dfpunk account export.");
  }

  return registerDfPunkAccountIntoPxe({
    account: primary,
    ethWallet: live.wallet,
    networkId: opts.networkId,
    aztecNodeUrl: opts.aztecNodeUrl,
    onProgress: opts.onProgress,
  });
}
