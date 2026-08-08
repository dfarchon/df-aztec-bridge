import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { normalizePath, type AppRoutePath } from "./routes.ts";

type RouterContextValue = {
  path: AppRoutePath;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

function readPath(): AppRoutePath {
  return normalizePath(window.location.pathname) as AppRoutePath;
}

export function RouterProvider(props: { children: ReactNode }) {
  const [path, setPath] = useState<AppRoutePath>(() =>
    typeof window === "undefined" ? ("/bridge" as AppRoutePath) : readPath(),
  );

  useEffect(() => {
    const onPop = () => setPath(readPath());
    window.addEventListener("popstate", onPop);
    // Normalize `/` → `/bridge` (or keep explorer deep links) once on mount
    const current = window.location.pathname;
    if (normalizePath(current) !== current) {
      window.history.replaceState({}, "", normalizePath(current));
      setPath(readPath());
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const next = normalizePath(to);
    if (opts?.replace) {
      window.history.replaceState({}, "", next);
    } else if (window.location.pathname !== next) {
      window.history.pushState({}, "", next);
    }
    setPath(next as AppRoutePath);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);

  return createElement(RouterContext.Provider, { value }, props.children);
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within RouterProvider");
  return ctx;
}

export function usePath(): AppRoutePath {
  return useRouter().path;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function Link(props: {
  to: string;
  children: ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  return createElement(
    "a",
    {
      href: props.to,
      className: props.className,
      title: props.title,
      onClick: (e: MouseEvent<HTMLAnchorElement>) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.altKey ||
          e.ctrlKey ||
          e.shiftKey
        ) {
          return;
        }
        e.preventDefault();
        props.onClick?.();
        navigate(props.to);
      },
    },
    props.children,
  );
}
