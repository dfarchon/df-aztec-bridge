import { Link, usePath } from "../../app/router.tsx";
import { NAV_ITEMS, ROUTES } from "../../app/routes.ts";
import { useUi } from "../../providers/UiProvider.tsx";

export function Sidebar() {
  const path = usePath();
  const { sidebarCollapsed, toggleSidebar } = useUi();

  return (
    <aside
      className={`app-sidebar${sidebarCollapsed ? " is-collapsed" : ""}`}
      aria-label="Main navigation"
    >
      <div className="app-sidebar-head">
        <Link className="identity-brand" to={ROUTES.bridge} title="DF Aztec Bridge">
          <img className="identity-brand-logo" src={`${import.meta.env.BASE_URL}dfaztec-logo.jpg`} alt="" width={34} height={34} />
          {!sidebarCollapsed ? (
            <span>
              <b>DFaztec</b>
              <small>Fee juice bridge</small>
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          className="ghost app-sidebar-toggle"
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Show menu" : "Hide menu"}
        >
          {sidebarCollapsed ? "»" : "« Hide"}
        </button>
      </div>

      <nav className="app-sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = path === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`app-sidebar-link${active ? " is-active" : ""}`}
              title={item.description}
            >
              <span className="app-sidebar-link-short mono" aria-hidden="true">
                {item.short}
              </span>
              {!sidebarCollapsed ? (
                <span className="app-sidebar-link-body">
                  <span className="app-sidebar-link-label">{item.label}</span>
                  <span className="app-sidebar-link-desc">{item.description}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
