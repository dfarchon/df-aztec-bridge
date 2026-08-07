/**
 * Bridge protocol fee: skim BPS of the gross L1 amount to an ETH fee recipient.
 * Net amount is what gets deposited to Aztec Fee Juice.
 *
 * On Ethereum mainnet, an additional native-ETH service fee (~1 L1 tx gas) is
 * sent to the same recipient before the AZTEC token skim (first wallet confirm).
 */
export const BRIDGE_FEE_BPS = 500; // 5%
export const BPS_DENOMINATOR = 10_000n;
/** L1 chain id where the ETH service fee applies. */
export const BRIDGE_ETH_FEE_CHAIN_ID = 1;
/** Gas units priced as "~1 L1 interaction" for the mainnet ETH service fee. */
export const BRIDGE_ETH_SERVICE_FEE_GAS = 100_000n;

export function computeBridgeFee(grossAmount: bigint, feeBps = BRIDGE_FEE_BPS): {
  gross: bigint;
  fee: bigint;
  net: bigint;
} {
  if (grossAmount <= 0n) {
    return { gross: 0n, fee: 0n, net: 0n };
  }
  const fee = (grossAmount * BigInt(feeBps)) / BPS_DENOMINATOR;
  const net = grossAmount - fee;
  return { gross: grossAmount, fee, net };
}

export function isValidFeeRecipient(address: string | undefined | null): address is `0x${string}` {
  return typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function shouldChargeBridgeEthServiceFee(chainId: number): boolean {
  return chainId === BRIDGE_ETH_FEE_CHAIN_ID;
}

/**
 * Resolve mainnet ETH service fee in wei.
 * Prefer `overrideWei` (env); otherwise gasPrice × BRIDGE_ETH_SERVICE_FEE_GAS.
 */
export async function resolveBridgeEthServiceFee(opts: {
  chainId: number;
  overrideWei?: bigint | null;
  getMaxFeePerGas?: () => Promise<bigint | null | undefined>;
  getGasPrice: () => Promise<bigint>;
}): Promise<bigint> {
  if (!shouldChargeBridgeEthServiceFee(opts.chainId)) return 0n;
  if (opts.overrideWei != null && opts.overrideWei > 0n) return opts.overrideWei;
  const maxFee = opts.getMaxFeePerGas ? await opts.getMaxFeePerGas() : null;
  const gasPrice =
    maxFee != null && maxFee > 0n ? maxFee : await opts.getGasPrice();
  if (gasPrice <= 0n) return 0n;
  return gasPrice * BRIDGE_ETH_SERVICE_FEE_GAS;
}

/** Parse optional env override (decimal wei string). */
export function parseEthFeeWeiOverride(raw: string | undefined | null): bigint | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  try {
    const v = BigInt(t);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}
