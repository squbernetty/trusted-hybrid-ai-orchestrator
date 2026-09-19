import {
  useState,
} from "react";

import {
  AppShell,
} from "../components/shell/AppShell";
import {
  pageForView,
  type AppView,
} from "./routes";

export function App() {
  const [
    activeView,
    setActiveView,
  ] = useState<AppView>(
    "overview",
  );

  const ActivePage =
    pageForView(activeView);

  return (
    <AppShell
      activeView={activeView}
      onNavigate={setActiveView}
    >
      <ActivePage />
    </AppShell>
  );
}
