/**
 * Bridge protocol fee helpers (shared with CLI/core).
 * Mainnet ETH service fee (~1 L1 tx) is applied in the browser-sdk wallet path.
 */
export const BRIDGE_FEE_BPS = 500;
export const BPS_DENOMINATOR = 10_000n;
export const BRIDGE_ETH_FEE_CHAIN_ID = 1;
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
