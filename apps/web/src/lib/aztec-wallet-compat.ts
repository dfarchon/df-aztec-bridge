/**
 * Client-side Aztec account compatibility vs this bridge (Aztec 6.0 only).
 * v5 vs v5.1 cannot be separated with the 6.0 SDK — both fail 6.0 address derivation.
 */

export type AztecWalletCompat =
  | "v6-initializerless"
  | "v6-schnorr"
  | "v6-external"
  | "pre-v6"
  | "unknown";

export function isAztecWalletBridgeSafe(compat: AztecWalletCompat | undefined): boolean {
  return (
    compat === "v6-initializerless" ||
    compat === "v6-schnorr" ||
    compat === "v6-external"
  );
}

export function aztecWalletCompatShortLabel(compat: AztecWalletCompat | undefined): string {
  switch (compat) {
    case "v6-initializerless":
      return "Aztec 6.0 (DF)";
    case "v6-schnorr":
      return "Aztec 6.0 (Schnorr)";
    case "v6-external":
      return "Aztec 6.0 (extension)";
    case "pre-v6":
      return "v5 / v5.1";
    case "unknown":
    default:
      return "Unknown";
  }
}

export function aztecWalletCompatWarning(compat: AztecWalletCompat | undefined): string | null {
  switch (compat) {
    case "pre-v6":
      return "This address is not an Aztec 6.0 wallet (likely v5 / v5.1). Do not bridge here — create or import a 6.0 DF account first.";
    case "unknown":
      return "Could not verify this Aztec address is 6.0. Import a dfpunk-account JSON or create a DF account before bridging.";
    case "v6-schnorr":
      return null;
    case "v6-initializerless":
    case "v6-external":
      return null;
    default:
      return null;
  }
}

export function walletCompatFromRegisterStyle(
  style: "schnorr_initializerless" | "schnorr",
): AztecWalletCompat {
  return style === "schnorr" ? "v6-schnorr" : "v6-initializerless";
}
