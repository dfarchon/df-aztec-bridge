/**
 * DF Aztec / protocol Sponsored FPC (Fee Payment Contract).
 * Canonical salt-derived instance (same as @aztec/constants SPONSORED_FPC_SALT).
 * Bridge Fee Juice *to this L2 address* to fund sponsored txs in DF Aztec.
 * This is NOT the L1 `BRIDGE_FEE_RECIPIENT` (5% Trezor treasury).
 */
export const CANONICAL_SPONSORED_FPC_ADDRESS =
  "0x1441491b59934ec64f8c98f17c91f23c01ca2a45dbb35caf123146ec76f9970c";

/** Build-time override for a custom / redeployed Sponsored FPC. */
export function getSponsoredFpcAddress(): string {
  const fromEnv = (import.meta.env.VITE_SPONSORED_FPC_ADDRESS as string | undefined)?.trim();
  if (fromEnv && /^0x[0-9a-fA-F]{64}$/.test(fromEnv)) return fromEnv;
  return CANONICAL_SPONSORED_FPC_ADDRESS;
}

export function isSponsoredFpcAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return address.trim().toLowerCase() === getSponsoredFpcAddress().toLowerCase();
}
