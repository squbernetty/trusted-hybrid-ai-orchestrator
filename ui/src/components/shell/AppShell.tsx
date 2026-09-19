import type {
  ReactNode,
} from "react";

import type {
  AppView,
} from "../../app/routes";
import {
  ServiceHealth,
} from "../status/ServiceHealth";
import {
  SidebarNav,
} from "./SidebarNav";

interface AppShellProps {
  activeView: AppView;
  children: ReactNode;
  onNavigate: (
    view: AppView,
  ) => void;
}

export function AppShell({
  activeView,
  children,
  onNavigate,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span
            className="brand__mark"
            aria-hidden="true"
          >
            TH
          </span>

          <div>
            <p className="brand__name">
              Trusted Hybrid AI
            </p>
            <p className="brand__product">
              Orchestrator
            </p>
          </div>
        </div>

        <ServiceHealth />
      </header>

      <div className="app-shell__body">
        <SidebarNav
          activeView={activeView}
          onNavigate={onNavigate}
        />

        <main
          className="workspace"
          id="main-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
