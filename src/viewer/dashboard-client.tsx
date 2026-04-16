import { hydrateRoot } from "react-dom/client";

import type { DashboardStateResponse } from "./dashboard-types.js";
import { DashboardApp } from "./react/dashboard-app.js";

const rootElement = document.getElementById("dashboard-root");
const stateElement = document.getElementById("dashboard-initial-state");

if (!rootElement || !stateElement?.textContent) {
  throw new Error("Dashboard bootstrap data is missing.");
}

const initialState = JSON.parse(stateElement.textContent) as DashboardStateResponse;

hydrateRoot(rootElement, <DashboardApp initialState={initialState} />);
