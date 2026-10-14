import { formatForDappToast } from "./privacy.ts";

export const APP_ERROR_TOAST_MAX = 4;

export const WALLET_TX_REJECTED_TITLE = "Transaction rejected";
export const WALLET_TX_REJECTED_DETAIL =
  "You cancelled the request in your wallet. Nothing was sent.";

export type AppErrorToastInput = {
  title: string;
  detail?: string;
};

export type AppErrorToast = AppErrorToastInput & {
  id: string;
  at: number;
};

const pending: AppErrorToastInput[] = [];
const listeners = new Set<(entry: AppErrorToastInput) => void>();

export function pushAppError(input: AppErrorToastInput): void {
  const entry: AppErrorToastInput = {
    ...input,
    title: formatForDappToast(input.title),
    detail: input.detail ? formatForDappToast(input.detail) : undefined,
  };
  if (listeners.size === 0) {
    pending.push(entry);
    while (pending.length > APP_ERROR_TOAST_MAX) pending.shift();
    return;
  }
  for (const listener of listeners) listener(entry);
}

export function subscribeAppError(listener: (entry: AppErrorToastInput) => void): () => void {
  listeners.add(listener);
  const queued = pending.splice(0, pending.length);
  for (const entry of queued) listener(entry);
  return () => {
    listeners.delete(listener);
  };
}
