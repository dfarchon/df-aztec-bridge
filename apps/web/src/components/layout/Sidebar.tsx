import { Link, usePath } from "../../app/router.tsx";
import { NAV_ITEMS } from "../../app/routes.ts";

export function Sidebar() {
  const path = usePath();

  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <nav className="app-sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = path === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`app-sidebar-link${active ? " is-active" : ""}`}
            >
              <span className="app-sidebar-link-body">
                <span className="app-sidebar-link-label">{item.label}</span>
                <span className="app-sidebar-link-desc">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
