/**
 * Single wipe path for in-memory bridge / claim secrets when the vault locks.
 * Call from every unlock → lock transition so UI state cannot diverge from vault lock policy.
 */

export type BridgeSensitiveUiClearers = {
  setDfPxeAccount: (value: null) => void;
  setVaultPxeAccount: (value: null) => void;
  setRecipient: (value: string) => void;
  setL2Secret: (value: string) => void;
  setL2Salt: (value: string) => void;
  setL2SigningKey: (value: string) => void;
  setShowL2Secret: (value: boolean) => void;
  setCredentials: (value: null) => void;
  setRecoverySessions: (value: []) => void;
  setSelectedRecoveryHash: (value: null) => void;
  setRecoveryPromptOpen: (value: boolean) => void;
  setImportedAccounts: (value: []) => void;
  setImportedIndex: (value: number) => void;
  setImportName: (value: null) => void;
  setShowBridgeResult: (value: boolean) => void;
  closeWalletPanel: () => void;
};

export function clearBridgeSensitiveUiState(clearers: BridgeSensitiveUiClearers): void {
  clearers.setDfPxeAccount(null);
  clearers.setVaultPxeAccount(null);
  clearers.setRecipient("");
  clearers.setL2Secret("");
  clearers.setL2Salt("0");
  clearers.setL2SigningKey("");
  clearers.setShowL2Secret(false);
  clearers.setCredentials(null);
  clearers.setRecoverySessions([]);
  clearers.setSelectedRecoveryHash(null);
  clearers.setRecoveryPromptOpen(false);
  clearers.setImportedAccounts([]);
  clearers.setImportedIndex(0);
  clearers.setImportName(null);
  clearers.setShowBridgeResult(false);
  clearers.closeWalletPanel();
}
