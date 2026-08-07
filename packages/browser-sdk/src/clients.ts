import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
  parseAbi,
  decodeEventLog,
  type Chain,
} from "viem";
import { sepolia, mainnet, foundry } from "viem/chains";
import { computeSecretHash } from "@aztec/aztec.js/crypto";
import { Fr } from "@aztec/foundation/curves/bn254";

export const erc20ReadAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const erc20WriteAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  1: mainnet,
  31337: foundry,
};

export function getChain(chainId: number): Chain {
  return CHAIN_MAP[chainId] ?? { ...sepolia, id: chainId, name: `Chain ${chainId}` };
}

export function toHex64(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const viemReadContract = (client: any, params: any) => client.readContract(params);

export function getL1PublicClient(
  l1RpcUrl: string,
  chainId: number,
  provider?: EIP1193Provider | null,
): PublicClient {
  const chain = getChain(chainId);
  if (provider) {
    return createPublicClient({ chain, transport: custom(provider) }) as PublicClient;
  }
  return createPublicClient({ chain, transport: http(l1RpcUrl) }) as PublicClient;
}

export async function getL1Clients(
  provider: EIP1193Provider,
  chainId: number,
  options?: { l1RpcUrl?: string },
): Promise<{
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Hex;
  chain: Chain;
}> {
  const chain = getChain(chainId);
  // Prefer a dedicated HTTP RPC for reads / receipt polling — wallet provider RPCs
  // (MetaMask etc.) frequently time out waiting for confirmations on mainnet.
  const publicClient = (
    options?.l1RpcUrl
      ? createPublicClient({ chain, transport: http(options.l1RpcUrl) })
      : createPublicClient({ chain, transport: custom(provider) })
  ) as PublicClient;
  const walletClient = createWalletClient({ chain, transport: custom(provider) }) as WalletClient;
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("No account connected");
  return { publicClient, walletClient, account, chain };
}

export async function generateClaimSecret(): Promise<{ secret: bigint; secretHash: bigint }> {
  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);
  return { secret: secret.toBigInt(), secretHash: secretHash.toBigInt() };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Too many request") ||
    message.includes("Too many requests") ||
    message.includes("429") ||
    message.includes("rate limit")
  );
}

function isReceiptWaitTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Timed out while waiting for transaction") ||
    message.includes("WaitForTransactionReceiptTimeoutError") ||
    message.includes("took too long")
  );
}

export async function waitForTransactionReceiptWithRetry(
  publicClient: PublicClient,
  hash: Hex,
  options?: {
    maxAttempts?: number;
    initialBackoffMs?: number;
    /** Per-attempt waitForTransactionReceipt timeout. Default 3 minutes. */
    timeoutMs?: number;
    pollingIntervalMs?: number;
  },
): Promise<TransactionReceipt> {
  const maxAttempts = options?.maxAttempts ?? 6;
  const initialBackoffMs = options?.initialBackoffMs ?? 2_000;
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const pollingIntervalMs = options?.pollingIntervalMs ?? 4_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // Fast path: already mined.
      const existing = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
      if (existing) return existing;

      return await publicClient.waitForTransactionReceipt({
        hash,
        timeout: timeoutMs,
        pollingInterval: pollingIntervalMs,
      });
    } catch (error) {
      lastError = error;
      const retryable = isRateLimitError(error) || isReceiptWaitTimeoutError(error);
      if (!retryable || attempt === maxAttempts) throw error;
      await sleep(initialBackoffMs * 2 ** (attempt - 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out while waiting for transaction receipt: ${hash}`);
}

const depositEventAbi = parseAbi([
  "event DepositToAztecPublic(bytes32 indexed to, uint256 amount, bytes32 secretHash, bytes32 key, uint256 index)",
]);

export type DepositEvent = {
  to: Hex;
  amount: bigint;
  secretHash: Hex;
  key: Hex;
  index: bigint;
  emitter: Hex;
};

export function extractAllDepositEvents(receipt: TransactionReceipt): DepositEvent[] {
  const events: DepositEvent[] = [];
  for (const log of receipt.logs) {
    try {
      const raw = log as unknown as { address?: Hex; data: Hex; topics: [Hex, ...Hex[]] };
      if (!raw.topics?.[0]) continue;
      const decoded = decodeEventLog({
        abi: depositEventAbi,
        data: raw.data,
        topics: raw.topics,
      }) as {
        args: { to: Hex; amount: bigint; secretHash: Hex; key: Hex; index: bigint };
      };
      const emitter = (log.address ?? raw.address) as Hex | undefined;
      if (!emitter) continue;
      events.push({ ...decoded.args, emitter });
    } catch {
      /* not a deposit event */
    }
  }
  return events;
}

export function extractDepositEvent(
  receipt: TransactionReceipt,
  expected: { portal: Hex; to: Hex; amount: bigint; secretHash: Hex },
): DepositEvent {
  const matches = extractAllDepositEvents(receipt).filter(
    (e) =>
      e.emitter.toLowerCase() === expected.portal.toLowerCase() &&
      e.to.toLowerCase() === expected.to.toLowerCase() &&
      e.amount === expected.amount &&
      e.secretHash.toLowerCase() === expected.secretHash.toLowerCase(),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one DepositToAztecPublic from portal ${expected.portal} ` +
        `matching to/amount/secretHash; found ${matches.length}`,
    );
  }
  return matches[0]!;
}

export function aztecRecipientToBytes32(aztecRecipient: string): Hex {
  const raw = aztecRecipient.startsWith("0x") ? aztecRecipient.slice(2) : aztecRecipient;
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length > 64) {
    throw new Error("Invalid Aztec address: expected hex (with optional 0x prefix), up to 32 bytes.");
  }
  return (`0x${raw.padStart(64, "0")}`) as Hex;
}

export interface FeeJuiceBalance {
  balance: bigint;
  formatted: string;
  decimals: number;
  /** On-chain ERC20 symbol when available (mainnet Fee Juice is often "AZTEC"). */
  symbol: string;
}

/** L1 Fee Juice / AZTEC token balance for a holder. */
export async function getFeeJuiceBalance(params: {
  tokenAddress: Hex;
  holder: Hex;
  chainId: number;
  l1RpcUrl?: string;
  provider?: EIP1193Provider | null;
}): Promise<FeeJuiceBalance> {
  const { tokenAddress, holder, chainId, l1RpcUrl } = params;
  if (!l1RpcUrl) {
    throw new Error("l1RpcUrl is required to read Fee Juice balance.");
  }
  const client = getL1PublicClient(l1RpcUrl, chainId, null);
  const fallbackSymbol = chainId === 1 ? "AZTEC" : "Fee Juice";
  const decimals = 18;

  // Single call to reduce public-RPC rate limits (skip decimals/symbol RPC).
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const balance = (await viemReadContract(client, {
        address: tokenAddress,
        abi: erc20ReadAbi,
        functionName: "balanceOf",
        args: [holder],
      })) as bigint;

      return {
        balance,
        formatted: formatUnits(balance, decimals),
        decimals,
        symbol: fallbackSymbol,
      };
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const rateLimited =
        msg.includes("Too many request") || msg.includes("429") || msg.includes("rate limit");
      if (!rateLimited || attempt === 4) break;
      await sleep(800 * 2 ** (attempt - 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type ProviderEmitter = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

/**
 * Subscribe to wallet account / chain changes (EIP-1193).
 * Returns an unsubscribe function.
 */
export function watchProviderSession(
  provider: EIP1193Provider,
  handlers: {
    onAccountsChanged?: (accounts: Hex[]) => void;
    onChainChanged?: (chainId: number) => void;
    onDisconnect?: () => void;
  },
): () => void {
  const p = provider as ProviderEmitter;
  if (typeof p.on !== "function") {
    return () => undefined;
  }

  const onAccounts = (...args: unknown[]) => {
    const accounts = (args[0] as string[] | undefined) ?? [];
    handlers.onAccountsChanged?.(accounts as Hex[]);
  };
  const onChain = (...args: unknown[]) => {
    const raw = args[0];
    const chainId =
      typeof raw === "string"
        ? Number.parseInt(raw, 16)
        : typeof raw === "number"
          ? raw
          : Number(raw);
    if (!Number.isNaN(chainId)) handlers.onChainChanged?.(chainId);
  };
  const onDisconnect = () => handlers.onDisconnect?.();

  p.on("accountsChanged", onAccounts);
  p.on("chainChanged", onChain);
  p.on?.("disconnect", onDisconnect);

  return () => {
    p.removeListener?.("accountsChanged", onAccounts);
    p.removeListener?.("chainChanged", onChain);
    p.removeListener?.("disconnect", onDisconnect);
  };
}
