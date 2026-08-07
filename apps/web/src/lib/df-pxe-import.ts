/**
 * Shared DF Punk → PXE registration (TypeScript only).
 * Used by WalletManagerPanel and the connect-session gate.
 */

import type { ConnectedWallet } from "@df-bridge/browser-sdk";
import {
  assertDfClientAccount,
  readAccountFile,
  type ImportedAztecAccount,
} from "./account-import.ts";
import { tryValidateConnectedWalletSession } from "./wallet-session-guard.ts";
import { pushDappLog } from "./dapp-log.ts";

export type DfPxeImportProgress = (detail: string) => void;

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
  if (!primary.signingKey?.trim()) {
    throw new Error("DF Punk account is missing signingKey — re-download from DF client.");
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

  await importDfpunkAccountIntoPxe({
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
  };
}
