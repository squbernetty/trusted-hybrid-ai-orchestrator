import {
  navigationItems,
  type AppView,
} from "../../app/routes";

interface SidebarNavProps {
  activeView: AppView;
  onNavigate: (
    view: AppView,
  ) => void;
}

export function SidebarNav({
  activeView,
  onNavigate,
}: SidebarNavProps) {
  return (
    <aside className="sidebar">
      <nav
        className="sidebar__nav"
        aria-label="Primary"
      >
        {navigationItems.map(
          (item) => (
            <button
              className="nav-item"
              data-active={
                activeView === item.id
                  ? "true"
                  : "false"
              }
              aria-current={
                activeView === item.id
                  ? "page"
                  : undefined
              }
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
              }}
              type="button"
            >
              <span
                className="nav-item__marker"
                aria-hidden="true"
              />
              <span>
                {item.label}
              </span>
            </button>
          ),
        )}
      </nav>

      <div className="sidebar__authority">
        <span className="authority-badge">
          Read only
        </span>

        <p>
          Local operator interface
        </p>

        <p className="sidebar__authority-note">
          Observation does not advance
          trusted state.
        </p>
      </div>
    </aside>
  );
}
