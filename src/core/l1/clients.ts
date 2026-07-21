import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  formatUnits,
  type Chain,
  type TransactionReceipt,
  parseAbi,
  decodeEventLog,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet, foundry } from "viem/chains";
import { computeSecretHash } from "@aztec/aztec.js/crypto";
import { Fr } from "@aztec/foundation/curves/bn254";

export const erc20ReadAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const erc20WriteAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
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

export function getL1PublicClient(l1RpcUrl: string, chainId: number): PublicClient {
  const chain = getChain(chainId);
  return createPublicClient({ chain, transport: http(l1RpcUrl) });
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

export function getL1ClientsFromPrivateKey(
  l1RpcUrl: string,
  chainId: number,
  privateKey: Hex,
): {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  accountAddress: Hex;
  chain: Chain;
} {
  const account = privateKeyToAccount(privateKey);
  const chain = getChain(chainId);
  const transport = http(l1RpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  return { publicClient, walletClient, account, accountAddress: account.address, chain };
}

export async function getFeeJuiceBalance(
  l1RpcUrl: string,
  chainId: number,
  tokenAddress: Hex,
  holder: Hex,
): Promise<{ balance: bigint; formatted: string; decimals: number }> {
  const publicClient = getL1PublicClient(l1RpcUrl, chainId);
  const [balance, decimals] = await Promise.all([
    viemReadContract(publicClient, {
      address: tokenAddress,
      abi: erc20ReadAbi,
      functionName: "balanceOf",
      args: [holder],
    }) as Promise<bigint>,
    viemReadContract(publicClient, {
      address: tokenAddress,
      abi: erc20ReadAbi,
      functionName: "decimals",
    }) as Promise<number>,
  ]);
  return { balance, formatted: formatUnits(balance, decimals), decimals };
}

export async function generateClaimSecret(): Promise<{ secret: bigint; secretHash: bigint }> {
  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);
  return { secret: secret.toBigInt(), secretHash: secretHash.toBigInt() };
}

export async function waitForTransactionReceiptWithRetry(
  publicClient: PublicClient,
  hash: Hex,
  options?: {
    maxAttempts?: number;
    initialBackoffMs?: number;
  },
): Promise<TransactionReceipt> {
  const maxAttempts = options?.maxAttempts ?? 8;
  const initialBackoffMs = options?.initialBackoffMs ?? 1_500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await publicClient.waitForTransactionReceipt({ hash });
    } catch (error) {
      if (!isRateLimitError(error) || attempt === maxAttempts) {
        throw error;
      }

      const backoffMs = initialBackoffMs * 2 ** (attempt - 1);
      await sleep(backoffMs);
    }
  }

  throw new Error(`Timed out while waiting for transaction receipt: ${hash}`);
}

const depositEventAbi = parseAbi([
  "event DepositToAztecPublic(bytes32 indexed to, uint256 amount, bytes32 secretHash, bytes32 key, uint256 index)",
]);

export function extractAllDepositEvents(receipt: TransactionReceipt) {
  const events: Array<{
    to: Hex;
    amount: bigint;
    secretHash: Hex;
    key: Hex;
    index: bigint;
  }> = [];
  for (const log of receipt.logs) {
    try {
      const raw = log as unknown as { data: Hex; topics: [Hex, ...Hex[]] };
      if (!raw.topics?.[0]) continue;
      const decoded = decodeEventLog({
        abi: depositEventAbi,
        data: raw.data,
        topics: raw.topics,
      }) as {
        args: { to: Hex; amount: bigint; secretHash: Hex; key: Hex; index: bigint };
      };
      events.push(decoded.args);
    } catch {
      /* not a deposit event */
    }
  }
  return events;
}
