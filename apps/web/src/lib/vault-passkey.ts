/**
 * WebAuthn / passkey helpers for the vault (no npm deps).
 * Used as a second factor alongside the admin password:
 * - setup: register platform / phone passkey
 * - unlock: require user verification (Face ID, fingerprint, PIN, or hybrid phone)
 */

import type { VaultPasskeyMeta } from "./vault-crypto.ts";

export type { VaultPasskeyMeta };

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function" &&
    (window.isSecureContext || location.hostname === "localhost")
  );
}

/** Prefer platform biometrics when the browser reports support. */
export async function prefersPlatformAuthenticator(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    /* ignore */
  }
  return false;
}

function b64Encode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

function b64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function userHandleFromAddress(aztecAddress: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(aztecAddress.trim().toLowerCase()),
  );
  return new Uint8Array(digest);
}

function rpId(): string {
  return window.location.hostname;
}

/** Current page hostname used as WebAuthn rpId. */
export function currentPasskeyRpId(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname;
}

/**
 * When stored passkey rpId ≠ current host (e.g. Netlify vs localhost), return a clear message.
 * Returns null when hosts match or passkey has no rpId.
 */
export function describePasskeyHostMismatch(passkey: VaultPasskeyMeta): string | null {
  const stored = (passkey.rpId || "").trim().toLowerCase();
  const current = currentPasskeyRpId().trim().toLowerCase();
  if (!stored || !current || stored === current) return null;
  return (
    `This vault's passkey was registered for "${passkey.rpId}", but you are on "${currentPasskeyRpId()}". ` +
    `Passkeys and IndexedDB do not transfer across hosts (localhost ≠ Netlify). ` +
    `Open the original site to unlock, or replace the passkey on this host after entering your password.`
  );
}

function vaultRpName(): string {
  return "DF Aztec Bridge Vault";
}

export class PasskeyError extends Error {
  /** Machine-readable recovery hint for the unlock UI. */
  readonly code?: "host_mismatch" | "missing_on_device" | "cancelled" | "other";

  constructor(
    message: string,
    code: PasskeyError["code"] = "other",
  ) {
    super(message);
    this.name = "PasskeyError";
    this.code = code;
  }
}

function mapWebAuthnError(err: unknown, action: "create" | "get"): PasskeyError {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const msg = e?.message ?? String(err);
  if (name === "NotAllowedError") {
    if (action === "get") {
      const host = currentPasskeyRpId() || "this site";
      return new PasskeyError(
        `No usable passkey for "${host}" on this device (cancelled, timed out, or never registered here). ` +
          `Enter your password and use “Replace passkey for this host”, or re-import DF Punk JSON to create a new vault.`,
        "missing_on_device",
      );
    }
    return new PasskeyError(
      "Passkey registration was cancelled or timed out. Try again, or use another authenticator.",
      "cancelled",
    );
  }
  if (name === "InvalidStateError") {
    return new PasskeyError(
      "A passkey for this vault may already exist on this authenticator. Continue with unlock, or remove the old passkey in system settings.",
    );
  }
  if (name === "NotSupportedError") {
    return new PasskeyError("This browser / device does not support passkeys.");
  }
  if (name === "SecurityError") {
    return new PasskeyError(
      "Passkeys require a secure context (HTTPS or localhost) and a matching site origin (rpId).",
      "host_mismatch",
    );
  }
  return new PasskeyError(msg || `Passkey ${action} failed.`);
}

/**
 * Register a passkey for this vault profile.
 * Prefers on-device biometrics; falls back to cross-platform (phone / security key).
 */
export async function registerVaultPasskey(opts: {
  aztecAddress: string;
  /** Prefer Face ID / fingerprint / Windows Hello when available. */
  preferPlatform?: boolean;
}): Promise<VaultPasskeyMeta> {
  if (!isWebAuthnAvailable()) {
    throw new PasskeyError("Passkeys are not available in this browser.");
  }

  const preferPlatform = opts.preferPlatform ?? (await prefersPlatformAuthenticator());
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = await userHandleFromAddress(opts.aztecAddress);
  const shortName = `${opts.aztecAddress.slice(0, 10)}…`;

  const base: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { name: vaultRpName(), id: rpId() },
    user: {
      id: userId,
      name: shortName,
      displayName: "DF Bridge vault",
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    timeout: 120_000,
    attestation: "none",
    authenticatorSelection: {
      userVerification: "required",
      residentKey: "preferred",
      requireResidentKey: false,
      ...(preferPlatform ? { authenticatorAttachment: "platform" as const } : {}),
    },
  };

  let cred: Credential | null = null;
  try {
    cred = await navigator.credentials.create({ publicKey: base });
  } catch (firstErr) {
    // Retry without platform attachment so phone / security key can be used.
    if (preferPlatform) {
      try {
        const { authenticatorAttachment: _drop, ...selection } = base.authenticatorSelection!;
        cred = await navigator.credentials.create({
          publicKey: {
            ...base,
            authenticatorSelection: selection,
          },
        });
      } catch (secondErr) {
        throw mapWebAuthnError(secondErr, "create");
      }
    } else {
      throw mapWebAuthnError(firstErr, "create");
    }
  }

  if (!cred || cred.type !== "public-key") {
    throw new PasskeyError("Passkey registration returned no credential.");
  }
  const pk = cred as PublicKeyCredential;
  const response = pk.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === "function" ? response.getTransports() : undefined;

  return {
    credentialId: b64Encode(pk.rawId),
    rpId: rpId(),
    createdAt: Date.now(),
    transports: transports?.length ? [...transports] : undefined,
  };
}

/** Prove possession of the registered passkey (second factor). */
export async function assertVaultPasskey(passkey: VaultPasskeyMeta): Promise<void> {
  if (!isWebAuthnAvailable()) {
    throw new PasskeyError("Passkeys are not available in this browser.");
  }
  if (!passkey.credentialId) {
    throw new PasskeyError("Vault passkey metadata is missing credentialId.");
  }

  const mismatch = describePasskeyHostMismatch(passkey);
  if (mismatch) {
    throw new PasskeyError(mismatch, "host_mismatch");
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const allow: PublicKeyCredentialDescriptor = {
    type: "public-key",
    id: b64Decode(passkey.credentialId),
    transports: passkey.transports as AuthenticatorTransport[] | undefined,
  };

  let cred: Credential | null = null;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: passkey.rpId || rpId(),
        allowCredentials: [allow],
        userVerification: "required",
        timeout: 120_000,
      },
    });
  } catch (err) {
    throw mapWebAuthnError(err, "get");
  }

  if (!cred || cred.type !== "public-key") {
    throw new PasskeyError("Passkey verification failed.", "missing_on_device");
  }
  const pk = cred as PublicKeyCredential;
  const gotId = b64Encode(pk.rawId);
  if (gotId !== passkey.credentialId) {
    throw new PasskeyError("Passkey credential did not match this vault.", "missing_on_device");
  }
}
