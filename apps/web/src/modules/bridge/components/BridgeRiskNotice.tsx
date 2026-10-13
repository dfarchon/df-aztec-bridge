import { useState } from "react";
import { BRIDGE_FEE_BPS } from "@df-bridge/browser-sdk";
import { OFFICIAL_DOCS_FEE_JUICE } from "../../../lib/official-links.ts";

const BRIDGE_RISK_SESSION_KEY = "df-bridge.risk-notice.accepted";

export function readBridgeRiskAccepted(): boolean {
  try {
    return sessionStorage.getItem(BRIDGE_RISK_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markBridgeRiskAccepted(): void {
  try {
    sessionStorage.setItem(BRIDGE_RISK_SESSION_KEY, "1");
  } catch {
    /* private mode: acceptance lasts for this page load via caller state */
  }
}

export function BridgeRiskNoticeBody() {
  return (
    <div className="bridge-risk-body">
      <p>
        Aztec is in early development. This bridge is an early test. Do not bridge an
        amount you cannot afford to lose.
      </p>
      <ul>
        <li>
          The <strong>$AZTEC</strong> you deposit on Ethereum is converted{" "}
          <strong>1:1</strong> into <strong>Fee Juice</strong> on Aztec.
        </li>
        <li>
          <strong>One way and irreversible.</strong> It cannot be withdrawn or bridged
          back to Ethereum or any other chain.
        </li>
        <li>
          <strong>Non-transferable.</strong> Fee Juice stays with the recipient address
          and cannot be sent to another account.
        </li>
        <li>
          <strong>Public balance.</strong> Fee Juice balances are public on-chain, while
          your transactions remain private.
        </li>
        <li>
          <strong className="fee-juice-emphasis">Only bridge the amount you need.</strong>
        </li>
      </ul>
      <p>
        A {BRIDGE_FEE_BPS / 100}% AZTEC fee, plus a mainnet ETH service fee of about one
        L1 transaction, goes to the DF Archon team.
      </p>
      <a
        className="official-docs-link"
        href={OFFICIAL_DOCS_FEE_JUICE}
        target="_blank"
        rel="noopener noreferrer"
      >
        Learn more in the official Aztec documentation ↗
      </a>
    </div>
  );
}

export function BridgeRiskGate({ onAccepted }: { onAccepted: () => void }) {
  const [checked, setChecked] = useState(false);

  return (
    <section className="bridge-risk-gate" aria-labelledby="bridge-risk-title">
      <p className="wallet-manager-pane-title" id="bridge-risk-title">
        Before you bridge
      </p>
      <BridgeRiskNoticeBody />
      <label className="check bridge-risk-confirm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>I have read this and I understand the risks.</span>
      </label>
      <button
        type="button"
        disabled={!checked}
        onClick={() => {
          markBridgeRiskAccepted();
          onAccepted();
        }}
      >
        Continue
      </button>
    </section>
  );
}

export function BridgeRiskNoticeDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal bridge-risk-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bridge-risk-dialog-title"
      >
        <div className="modal-header">
          <p className="wallet-manager-pane-title" id="bridge-risk-dialog-title">
            Before you bridge
          </p>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"
              />
            </svg>
          </button>
        </div>
        <BridgeRiskNoticeBody />
      </div>
    </div>
  );
}
