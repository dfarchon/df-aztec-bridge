export const ROUTES = {
  home: "/",
  bridge: "/bridge",
  recover: "/recover",
  vault: "/vault",
  explorer: "/explorer",
} as const;

export type AppNavPath =
  | typeof ROUTES.bridge
  | typeof ROUTES.recover
  | typeof ROUTES.vault;

/** App shell paths + AztecScan-shaped local explorer deep links. */
export type AppRoutePath =
  | AppNavPath
  | typeof ROUTES.explorer
  | `/blocks/${string}`
  | `/tx-effects/${string}`
  | `/address/${string}`;

export type NavItem = {
  path: AppNavPath;
  label: string;
  short: string;
  description: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    path: ROUTES.bridge,
    label: "Bridge",
    short: "B",
    description: "L1 Fee Juice bridge",
  },
  {
    path: ROUTES.recover,
    label: "Recover",
    short: "R",
    description: "Resume claim credentials",
  },
  {
    path: ROUTES.vault,
    label: "Vault",
    short: "V",
    description: "Password IndexedDB JSON",
  },
];

export type ExplorerView =
  | { kind: "index" }
  | { kind: "block"; blockNumber: number }
  | { kind: "txEffect"; txHash: string }
  | { kind: "address"; address: string };

export function parseExplorerRoute(pathname: string): ExplorerView | null {
  const cleaned = (pathname || "/").replace(/\/+$/, "") || "/";
  if (cleaned === ROUTES.explorer) return { kind: "index" };

  const block = cleaned.match(/^\/blocks\/(\d+)$/);
  if (block) return { kind: "block", blockNumber: Number(block[1]) };

  const tx = cleaned.match(/^\/tx-effects\/(0x[a-fA-F0-9]+|[a-fA-F0-9]+)$/);
  if (tx) {
    const raw = tx[1];
    return { kind: "txEffect", txHash: raw.startsWith("0x") ? raw : `0x${raw}` };
  }

  const addr = cleaned.match(/^\/address\/([0-9a-zA-Z_:-]+)$/);
  if (addr) return { kind: "address", address: addr[1] };

  return null;
}

export function isExplorerPath(pathname: string): boolean {
  return parseExplorerRoute(pathname) !== null;
}

export function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return ROUTES.bridge;
  const cleaned = pathname.replace(/\/+$/, "") || "/";
  // Legacy /network bookmarks → bridge (integrity lives on bridge; setup in wallet manager)
  if (cleaned === "/network") return ROUTES.bridge;
  if (
    cleaned === ROUTES.bridge ||
    cleaned === ROUTES.recover ||
    cleaned === ROUTES.vault
  ) {
    return cleaned;
  }
  if (isExplorerPath(cleaned)) return cleaned;
  return ROUTES.bridge;
}

export function isAppRoute(path: string): path is AppNavPath {
  return (
    path === ROUTES.bridge ||
    path === ROUTES.recover ||
    path === ROUTES.vault
  );
}
