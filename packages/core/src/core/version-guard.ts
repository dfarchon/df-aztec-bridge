/** Client packages must match the live Aztec network version (docs.aztec.network/networks). */
export const SUPPORTED_AZTEC_CLIENT_VERSION = "5.2.0";

export function assertAztecNodeVersionCompatible(nodeVersion: string | undefined | null): void {
  if (!nodeVersion) {
    throw new Error(
      `Aztec node did not report a version; refusing value-bearing operations. Expected client ${SUPPORTED_AZTEC_CLIENT_VERSION}.`,
    );
  }
  const normalized = nodeVersion.replace(/^v/, "");
  if (normalized !== SUPPORTED_AZTEC_CLIENT_VERSION) {
    throw new Error(
      `Aztec client/node version mismatch: client=${SUPPORTED_AZTEC_CLIENT_VERSION}, node=${normalized}. ` +
        `Upgrade packages as a coordinated set to the live network version.`,
    );
  }
}
