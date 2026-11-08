/**
 * Pinned L1 fee treasury. A Netlify UI override must not redirect the 5% fee.
 * Address is the one committed in netlify.toml.
 */

export const CANONICAL_BRIDGE_FEE_RECIPIENT = "0x33D5928E1c66E831Eb250D1250bf2CfF9eACa370";

export function assertPinnedFeeRecipient(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return CANONICAL_BRIDGE_FEE_RECIPIENT;
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error("VITE_BRIDGE_FEE_RECIPIENT must be a 0x-prefixed 20-byte address.");
  }
  if (trimmed.toLowerCase() !== CANONICAL_BRIDGE_FEE_RECIPIENT.toLowerCase()) {
    throw new Error(
      "VITE_BRIDGE_FEE_RECIPIENT does not match the pinned treasury address. Refusing to retarget the 5% fee.",
    );
  }
  return CANONICAL_BRIDGE_FEE_RECIPIENT;
}
