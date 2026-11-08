import { Link, usePath } from "../../app/router.tsx";
import { NAV_ITEMS } from "../../app/routes.ts";
import { eventUrlOrNull } from "../../lib/event-url.ts";

export function Sidebar() {
  const path = usePath();
  const eventUrl = eventUrlOrNull(import.meta.env.VITE_DF_AZTEC_EVENT_URL);

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
      {eventUrl ? <a
        className="sidebar-event"
        href={eventUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="DF Aztec Season 1 in progress. Visit the event site (opens in a new tab)."
      >
        <span className="sidebar-event-art" aria-hidden="true">
          <img src="/images/df-aztec-season1.png" alt="" />
          <span className="sidebar-event-sparkle sidebar-event-sparkle-one">✦</span>
          <span className="sidebar-event-sparkle sidebar-event-sparkle-two">✧</span>
        </span>
        <span className="sidebar-event-copy">
          <span className="sidebar-event-label">DF AZTEC</span>
          <strong>Season 1 is live</strong>
          <span className="sidebar-event-cta">Explore the event <span aria-hidden="true">↗</span></span>
        </span>
      </a> : null}
    </aside>
  );
}
