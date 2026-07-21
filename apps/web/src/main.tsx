import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const App = lazy(() =>
  import("./App").then((m) => ({
    default: m.App,
  })),
);

function dismissBootSplash() {
  const el = document.getElementById("boot-splash");
  if (!el) return;
  el.classList.add("boot-splash-leave");
  el.setAttribute("aria-busy", "false");
  window.setTimeout(() => el.remove(), 280);
}

/** Renders after the lazy App chunk resolves, then fades out the HTML splash. */
function Boot() {
  useEffect(() => {
    dismissBootSplash();
  }, []);
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Boot />
    </Suspense>
  </StrictMode>,
);
