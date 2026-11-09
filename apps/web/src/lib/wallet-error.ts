/**
 * User-facing copy for Ethereum wallet failures.
 * MetaMask returns a viem dump when its keyring is locked:
 * "KeyringController - The operation cannot be completed while the controller is locked."
 */

export const WALLET_LOCKED_TITLE = "Wallet is locked";
export const WALLET_LOCKED_DETAIL = "Unlock it in the extension, then try again.";

const LOCKED_WALLET =
  /keyringcontroller|controller is locked|wallet is locked|metamask is locked/i;

export function isWalletLockedMessage(text: string): boolean {
  return LOCKED_WALLET.test(text);
}

export function walletErrorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const extra = err as Error & {
      details?: unknown;
      shortMessage?: unknown;
      cause?: unknown;
    };
    return [extra.message, extra.shortMessage, extra.details, extra.cause ? walletErrorText(extra.cause) : ""]
      .filter((part) => typeof part === "string" && part.trim())
      .join("\n");
  }
  if (err && typeof err === "object") {
    const extra = err as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    return [extra.message, extra.shortMessage, extra.details, extra.cause ? walletErrorText(extra.cause) : ""]
      .filter((part) => typeof part === "string" && part.trim())
      .join("\n");
  }
  return err == null ? "" : String(err);
}

/** Drop viem request dumps. A locked keyring becomes one short instruction. */
export function presentWalletError(err: unknown): string {
  const text = walletErrorText(err).replace(/\s+/g, " ").trim();
  if (!text) return "The wallet could not complete that request.";
  if (isWalletLockedMessage(text) || text === WALLET_LOCKED_DETAIL) return WALLET_LOCKED_DETAIL;

  if (!/version:\s*viem@/i.test(text) && !/request arguments:/i.test(text)) return text;

  const details = text.match(/Details:\s*(.+?)(?:\s+Version:\s*viem@|$)/i)?.[1]?.trim();
  if (details) {
    if (isWalletLockedMessage(details)) return WALLET_LOCKED_DETAIL;
    return details;
  }

  const first = text.split(/Request Arguments:/i)[0]?.replace(/\s*Version:\s*viem@[\d.]+\s*/i, "").trim();
  return first || "The wallet could not complete that request.";
}
