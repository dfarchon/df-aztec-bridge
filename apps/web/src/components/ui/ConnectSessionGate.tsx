import { createContext, useState, type ReactNode } from "react";

/**
 * Host below the connect card. `undefined` means this panel is not in the gate
 * (wallet drawer) and should keep notices in place. `null` means the gate host
 * is not mounted yet.
 */
export const ConnectNoticeHostContext = createContext<HTMLElement | null | undefined>(
  undefined,
);

/** Centered connect step until the Ethereum wallet and Aztec account are ready. */
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
  const split = !!props.ethConnected || !!props.ethSessionOk;
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);

  return (
    <section
      className={`connect-gate is-wallets${split ? " is-split" : ""}`}
      aria-label={split ? "Ethereum L1 and Aztec L2" : "Connect a wallet"}
    >
      <ConnectNoticeHostContext.Provider value={noticeHost}>
        <div className="connect-gate-stack">
          <div className="connect-gate-card">
            {split ? null : (
              <h1 className="connect-gate-title">Connect a wallet</h1>
            )}
            {props.walletPanel}
          </div>
          <div ref={setNoticeHost} className="connect-gate-notices" />
        </div>
      </ConnectNoticeHostContext.Provider>
    </section>
  );
}
