export const ROUTES = {
  home: "/",
  bridge: "/bridge",
  recover: "/recover",
  vault: "/vault",
  history: "/history",
} as const;

export type AppNavPath =
  | typeof ROUTES.bridge
  | typeof ROUTES.recover
  | typeof ROUTES.vault
  | typeof ROUTES.history;

export type AppRoutePath = AppNavPath;

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
    description: "What's saved in this browser",
  },
  {
    path: ROUTES.history,
    label: "History",
    short: "H",
    description: "Deposits, claims, accounts",
  },
];

export function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return ROUTES.bridge;
  const cleaned = pathname.replace(/\/+$/, "") || "/";
  // Legacy /network bookmarks → bridge (integrity lives on bridge; setup in wallet manager)
  if (cleaned === "/network") return ROUTES.bridge;
  if (
    cleaned === ROUTES.bridge ||
    cleaned === ROUTES.recover ||
    cleaned === ROUTES.vault ||
    cleaned === ROUTES.history
  ) {
    return cleaned;
  }
  return ROUTES.bridge;
}

export function isAppRoute(path: string): path is AppNavPath {
  return (
    path === ROUTES.bridge ||
    path === ROUTES.recover ||
    path === ROUTES.vault ||
    path === ROUTES.history
  );
}
