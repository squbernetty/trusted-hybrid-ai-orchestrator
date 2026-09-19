import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import {
  applicationObservationSession,
} from "./app/applicationObservation";
import "./styles.css";

const root =
  document.getElementById(
    "root",
  );

if (root === null) {
  throw new Error(
    "UI root element is unavailable.",
  );
}


createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


/*
 * Application observation startup belongs to the document
 * composition boundary, not to React component lifecycle.
 *
 * React StrictMode may intentionally mount, clean up, and mount
 * component effects again in development. The application
 * observation session is terminal after stop(), so binding
 * start/stop to component effects would create false lifecycle
 * transitions and duplicate bootstrap attempts.
 *
 * This module-level start executes once for the document load.
 * HMR is disabled by the qualified Vite configuration.
 *
 * Browser document teardown owns final disposal of browser
 * resources. No React cleanup calls the terminal session stop().
 */
void applicationObservationSession
  .start()
  .catch(
    () => {
      /*
       * Do not fabricate trusted execution state or retry.
       *
       * Bootstrap source results and controller/store snapshots
       * remain the presentation basis. Keep the console message
       * generic so implementation diagnostics are not exposed.
       */
      console.error(
        "Application observation startup failed.",
      );
    },
  );
