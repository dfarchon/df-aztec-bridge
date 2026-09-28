import { Link, usePath } from "../../app/router.tsx";
import { NAV_ITEMS, ROUTES } from "../../app/routes.ts";
import { DecodeText } from "../../theme/DecodeText.tsx";
export function Sidebar() {
  const path = usePath();

  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <div className="app-sidebar-head">
        <Link className="identity-brand" to={ROUTES.bridge} title="DF Aztec Bridge">
          <img className="identity-brand-logo" src={`${import.meta.env.BASE_URL}dfaztec-logo.jpg`} alt="" width={34} height={34} />
          <span>
            <b>
              <DecodeText>DFARCHON</DecodeText>
            </b>
            <small>Fee juice bridge</small>
          </span>
        </Link>
      </div>

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
