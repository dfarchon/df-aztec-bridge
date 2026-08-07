/**
 * Bridge protocol fee: skim BPS of the gross L1 amount to an ETH fee recipient.
 * Net amount is what gets deposited to Aztec Fee Juice.
 */
export const BRIDGE_FEE_BPS = 500; // 5%
export const BPS_DENOMINATOR = 10_000n;

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
