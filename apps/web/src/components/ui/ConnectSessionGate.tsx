import type { ReactNode } from "react";

/**
 * Centered wallet manager while MetaMask/WalletConnect + DF Punk PXE are not ready.
 */
export function ConnectSessionGate(props: {
  ethConnected?: boolean;
  ethSessionOk?: boolean;
  pxeReady?: boolean;
  vaultAvailable?: boolean;
  dfpunkPlayUrl?: string;
  canImportPxe?: boolean;
  importingPxe?: boolean;
  unlockingVault?: boolean;
  onImportPxeFile?: (file: File) => void | Promise<void>;
  onUnlockVault?: () => void | Promise<void>;
  importError?: string | null;
  walletPanel?: ReactNode;
}) {
  return (
    <section className="connect-gate is-wallets" aria-label="Connect wallets to continue">
      <div className="connect-gate-card">
        <p className="label">wallet manager</p>
        {props.walletPanel}
      </div>
    </section>
  );
}
