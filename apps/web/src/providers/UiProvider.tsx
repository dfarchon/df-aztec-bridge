import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const SIDEBAR_KEY = "df-bridge.sidebar.collapsed";

type UiContextValue = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  walletPanelOpen: boolean;
  openWalletPanel: () => void;
  closeWalletPanel: () => void;
  toggleWalletPanel: () => void;
  /** True when validated Web3 + DF Punk PXE session unlocks menus / routes. */
  shellReady: boolean;
  setShellReady: (v: boolean) => void;
};

const UiContext = createContext<UiContextValue | null>(null);

function readCollapsed(): boolean {
  try {
    return sessionStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function UiProvider(props: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(readCollapsed);
  const [walletPanelOpen, setWalletPanelOpen] = useState(false);
  const [shellReady, setShellReady] = useState(false);

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    try {
      sessionStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<UiContextValue>(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      walletPanelOpen,
      openWalletPanel: () => setWalletPanelOpen(true),
      closeWalletPanel: () => setWalletPanelOpen(false),
      toggleWalletPanel: () => setWalletPanelOpen((o) => !o),
      shellReady,
      setShellReady,
    }),
    [sidebarCollapsed, setSidebarCollapsed, toggleSidebar, walletPanelOpen, shellReady],
  );

  return <UiContext.Provider value={value}>{props.children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used within UiProvider");
  return ctx;
}
