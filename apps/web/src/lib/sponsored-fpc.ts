/**
 * DF Aztec / protocol Sponsored FPC (Fee Payment Contract).
 * Canonical salt-derived instance (same as @aztec-labs/constants SPONSORED_FPC_SALT).
 * Bridge Fee Juice *to this L2 address* to fund sponsored txs in DF Aztec.
 * This is NOT the L1 `BRIDGE_FEE_RECIPIENT` (5% Trezor treasury).
 *
 * Pinned like the L1 fee recipient: a Netlify/env override must not retarget which
 * L2 address counts as the Sponsored FPC. Change the canonical constant in code to redeploy.
 */

export const CANONICAL_SPONSORED_FPC_ADDRESS =
  "0x1441491b59934ec64f8c98f17c91f23c01ca2a45dbb35caf123146ec76f9970c";

/** Empty env → canonical. Any other address fails the build / module load. */
export function assertPinnedSponsoredFpc(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return CANONICAL_SPONSORED_FPC_ADDRESS;
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("VITE_SPONSORED_FPC_ADDRESS must be a 0x-prefixed 32-byte Aztec address.");
  }
  if (trimmed.toLowerCase() !== CANONICAL_SPONSORED_FPC_ADDRESS.toLowerCase()) {
    throw new Error(
      "VITE_SPONSORED_FPC_ADDRESS does not match the pinned Sponsored FPC. Refusing to retarget sponsor-mode UX.",
    );
  }
  return CANONICAL_SPONSORED_FPC_ADDRESS;
}

/** Build-time / runtime pinned Sponsored FPC (env may only repeat the canonical address). */
export function getSponsoredFpcAddress(): string {
  return assertPinnedSponsoredFpc(
    import.meta.env.VITE_SPONSORED_FPC_ADDRESS as string | undefined,
  );
}

export function isSponsoredFpcAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return address.trim().toLowerCase() === getSponsoredFpcAddress().toLowerCase();
}
