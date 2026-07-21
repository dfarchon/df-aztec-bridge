/**
 * Account file parsers for the web form.
 *
 * Canonical format (`dfpunk-account-*.json`):
 * ```json
 * {
 *   "address": "0x…",
 *   "secretKey": "0x…",
 *   "salt": "0x…",
 *   "signingKey": "…",
 *   "createdAt": 0
 * }
 * ```
 */

export interface ImportedAztecAccount {
  address: string;
  secretKey: string;
  salt: string;
  /** Present in dfpunk files; required to reopen those accounts for claim. */
  signingKey?: string;
  createdAt?: number;
  label?: string;
}

/** Canonical dfpunk single-account object. */
type DfpunkAccount = {
  address?: unknown;
  secretKey?: unknown;
  salt?: unknown;
  signingKey?: unknown;
  createdAt?: unknown;
};

/** Our CLI `create-account -o` shape (also accepted). */
type CliAccountRow = {
  aztecAddress?: unknown;
  l2SecretKey?: unknown;
  salt?: unknown;
  networkId?: unknown;
};

function asHexField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid "${field}"`);
  }
  const v = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(v) && !/^[0-9a-fA-F]+$/.test(v)) {
    throw new Error(`Invalid hex in "${field}"`);
  }
  return v.startsWith("0x") ? v : `0x${v}`;
}

function normalizeDfpunk(row: DfpunkAccount, index = 0): ImportedAztecAccount {
  try {
    return {
      address: asHexField(row.address, "address"),
      secretKey: asHexField(row.secretKey, "secretKey"),
      salt: asHexField(row.salt, "salt"),
      signingKey:
        typeof row.signingKey === "string" && row.signingKey.trim()
          ? asHexField(row.signingKey, "signingKey")
          : undefined,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : undefined,
      label: index === 0 ? "dfpunk account" : `dfpunk account #${index + 1}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(index > 0 ? `Account[${index}]: ${msg}` : msg);
  }
}

function normalizeCli(row: CliAccountRow): ImportedAztecAccount {
  return {
    address: asHexField(row.aztecAddress, "aztecAddress"),
    secretKey: asHexField(row.l2SecretKey, "l2SecretKey"),
    salt: asHexField(row.salt ?? "0x0", "salt"),
    label: typeof row.networkId === "string" ? row.networkId : "cli account",
  };
}

function isDfpunkAccount(obj: Record<string, unknown>): boolean {
  return "address" in obj && "secretKey" in obj && "salt" in obj;
}

/**
 * Parse uploaded JSON into one or more accounts.
 * Primary: single dfpunk object. Also accepts an array of those, or CLI create-account JSON.
 */
export function parseAccountUpload(raw: unknown): ImportedAztecAccount[] {
  if (Array.isArray(raw)) {
    if (raw.length === 0) throw new Error("Account file is an empty array");
    return raw.map((row, i) => normalizeDfpunk(row as DfpunkAccount, i));
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (isDfpunkAccount(obj)) {
      return [normalizeDfpunk(obj as DfpunkAccount)];
    }
    if ("aztecAddress" in obj || "l2SecretKey" in obj) {
      return [normalizeCli(obj as CliAccountRow)];
    }
  }
  throw new Error(
    'Unrecognized account JSON. Expected dfpunk { address, secretKey, salt, signingKey?, createdAt? }.',
  );
}

export async function readAccountFile(file: File): Promise<ImportedAztecAccount[]> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("File is not valid JSON");
  }
  return parseAccountUpload(json);
}
