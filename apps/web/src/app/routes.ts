export const ROUTES = {
  home: "/",
  bridge: "/bridge",
  recover: "/recover",
  network: "/network",
  vault: "/vault",
} as const;

export type AppRoutePath =
  | typeof ROUTES.bridge
  | typeof ROUTES.recover
  | typeof ROUTES.network
  | typeof ROUTES.vault;

export type NavItem = {
  path: AppRoutePath;
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
    path: ROUTES.network,
    label: "Network",
    short: "N",
    description: "Integrity and RPC",
  },
  {
    path: ROUTES.vault,
    label: "Vault",
    short: "V",
    description: "Password IndexedDB JSON",
  },
];

export function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return ROUTES.bridge;
  const cleaned = pathname.replace(/\/+$/, "") || "/";
  if (
    cleaned === ROUTES.bridge ||
    cleaned === ROUTES.recover ||
    cleaned === ROUTES.network ||
    cleaned === ROUTES.vault
  ) {
    return cleaned;
  }
  return ROUTES.bridge;
}

export function isAppRoute(path: string): path is AppRoutePath {
  return (
    path === ROUTES.bridge ||
    path === ROUTES.recover ||
    path === ROUTES.network ||
    path === ROUTES.vault
  );
}
