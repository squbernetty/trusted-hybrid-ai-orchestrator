import type {
  ComponentType,
} from "react";

import {
  EventsPage,
} from "../pages/EventsPage";
import {
  OverviewPage,
} from "../pages/OverviewPage";
import {
  TaskPage,
} from "../pages/TaskPage";

export type AppView =
  | "overview"
  | "task"
  | "events";

export interface NavigationItem {
  id: AppView;
  label: string;
  shortLabel: string;
}

export const navigationItems:
  readonly NavigationItem[] = [
    {
      id: "overview",
      label: "Overview",
      shortLabel: "Overview",
    },
    {
      id: "task",
      label: "Task / Execution",
      shortLabel: "Task",
    },
    {
      id: "events",
      label: "Event Timeline",
      shortLabel: "Events",
    },
  ];

const pages:
  Record<AppView, ComponentType> = {
    overview: OverviewPage,
    task: TaskPage,
    events: EventsPage,
  };

export function pageForView(
  view: AppView,
): ComponentType {
  return pages[view];
}
