// N16.6 UI ALPHA INTEGRATION QUALIFICATION

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tsModule =
  await import("typescript");

const ts =
  tsModule.default
  ?? tsModule;

const scriptDirectory =
  path.dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const uiRoot =
  path.dirname(
    scriptDirectory,
  );


function moduleUrl(
  source,
) {
  return (
    "data:text/javascript;base64,"
    + Buffer.from(
        source,
        "utf8",
      ).toString(
        "base64",
      )
  );
}


async function readSource(
  ...parts
) {
  return readFile(
    path.join(
      uiRoot,
      ...parts,
    ),
    "utf8",
  );
}


const routesSource =
  await readSource(
    "src",
    "app",
    "routes.tsx",
  );

const mainSource =
  await readSource(
    "src",
    "main.tsx",
  );

const reactObservationSource =
  await readSource(
    "src",
    "app",
    "reactObservation.ts",
  );

const applicationObservationSource =
  await readSource(
    "src",
    "app",
    "applicationObservation.ts",
  );

const serviceHealthSource =
  await readSource(
    "src",
    "components",
    "status",
    "ServiceHealth.tsx",
  );

const overviewSource =
  await readSource(
    "src",
    "pages",
    "OverviewPage.tsx",
  );

const taskPageSource =
  await readSource(
    "src",
    "pages",
    "TaskPage.tsx",
  );

const eventsPageSource =
  await readSource(
    "src",
    "pages",
    "EventsPage.tsx",
  );

const executionProjectionSource =
  await readSource(
    "src",
    "presentation",
    "executionPathProjection.ts",
  );

const overviewProjectionSource =
  await readSource(
    "src",
    "presentation",
    "overviewProjection.ts",
  );

const eventTimelineProjectionSource =
  await readSource(
    "src",
    "presentation",
    "eventTimelineProjection.ts",
  );

const stylesSource =
  await readSource(
    "src",
    "styles.css",
  );


// ------------------------------------------------------------
// Alpha operator surface is complete.
// ------------------------------------------------------------

for (const required of [
  'id: "overview"',
  'id: "task"',
  'id: "events"',
  "OverviewPage",
  "TaskPage",
  "EventsPage",
]) {
  assert.equal(
    routesSource.includes(
      required,
    ),
    true,
    `UI Alpha route surface missing ${required}`,
  );
}

assert.equal(
  (
    routesSource.match(
      /\|\s*"overview"|\|\s*"task"|\|\s*"events"/g,
    )
    ?? []
  ).length,
  3,
  "UI Alpha AppView must remain exactly overview/task/events",
);


// ------------------------------------------------------------
// No user-visible milestone placeholders or obsolete deferrals.
// Search pages only; historical qualifier comments are allowed.
// ------------------------------------------------------------

for (const [
  name,
  source,
] of [
  ["OverviewPage", overviewSource],
  ["TaskPage", taskPageSource],
  ["EventsPage", eventsPageSource],
]) {
  for (const obsolete of [
    "Timeline pending",
    "Timeline rendering not enabled",
    "Task detail selection not enabled",
    "Task discovery and observation",
    "intentionally deferred to N16.2",
    "Bootstrap and SSE ingestion are",
    "Stream not connected",
  ]) {
    assert.equal(
      source.includes(
        obsolete,
      ),
      false,
      `${name} retains obsolete Alpha placeholder/deferral copy: ${obsolete}`,
    );
  }
}


// ------------------------------------------------------------
// Presentation pages/projections remain non-authoritative.
// ------------------------------------------------------------

for (const [
  name,
  source,
] of [
  ["OverviewPage", overviewSource],
  ["TaskPage", taskPageSource],
  ["EventsPage", eventsPageSource],
  ["overviewProjection", overviewProjectionSource],
  ["executionPathProjection", executionProjectionSource],
  ["eventTimelineProjection", eventTimelineProjectionSource],
]) {
  for (const forbidden of [
    "fetch(",
    "EventSource(",
    "WebSocket(",
    "XMLHttpRequest",
    ".dispatch(",
    ".start(",
    ".continue(",
    ".stop(",
    "AbortController",
    "setTimeout(",
    "setInterval(",
    "requestAnimationFrame(",
    "localStorage",
    "sessionStorage",
    "history.",
    "location.",
  ]) {
    assert.equal(
      source.includes(
        forbidden,
      ),
      false,
      `${name} gained forbidden authority primitive ${forbidden}`,
    );
  }
}


// ------------------------------------------------------------
// Task collection truncation must be preserved and disclosed.
// ------------------------------------------------------------

for (const required of [
  "taskCollectionTruncated",
  "taskObservation",
  "?.truncated",
]) {
  assert.equal(
    executionProjectionSource.includes(
      required,
    ),
    true,
    `execution path projection missing truncation contract ${required}`,
  );
}

for (const required of [
  "taskCollectionTruncated",
  "Observed task snapshot is",
  "truncated.",
  "bounded snapshot",
  "additional",
  "tasks may exist.",
]) {
  assert.equal(
    taskPageSource.includes(
      required,
    ),
    true,
    `TaskPage missing bounded task truncation disclosure ${required}`,
  );
}

assert.equal(
  stylesSource.includes(
    ".task-path-truncation-note",
  ),
  true,
  "TaskPage truncation disclosure styling missing",
);


// ------------------------------------------------------------
// Execute the pure projection and verify null/false/true states.
// ------------------------------------------------------------

const transpiledProjection =
  ts.transpileModule(
    executionProjectionSource,
    {
      compilerOptions: {
        target:
          ts.ScriptTarget.ES2022,

        module:
          ts.ModuleKind.ES2022,
      },
    },
  ).outputText;

const projection =
  await import(
    moduleUrl(
      transpiledProjection,
    ),
  );


function observation(
  tasks,
  truncated,
) {
  return Object.freeze({
    observed:
      Object.freeze({
        health:
          null,

        tasks:
          tasks === null
            ? null
            : Object.freeze({
                tasks:
                  Object.freeze(
                    tasks,
                  ),

                limit:
                  100,

                truncated,
              }),

        eventTail:
          null,

        eventWindow:
          Object.freeze([]),
      }),

    derived:
      Object.freeze({
        bootstrapEventCursor:
          null,

        currentEventCursor:
          null,
      }),
  });
}


const noTasksObserved =
  projection
    .createExecutionPathPresentation(
      observation(
        null,
        false,
      ),
      null,
    );

assert.equal(
  noTasksObserved.tasksObserved,
  false,
);

assert.equal(
  noTasksObserved.taskCollectionTruncated,
  null,
);


const completeTasks =
  projection
    .createExecutionPathPresentation(
      observation(
        [],
        false,
      ),
      null,
    );

assert.equal(
  completeTasks.tasksObserved,
  true,
);

assert.equal(
  completeTasks.taskCollectionTruncated,
  false,
);


const truncatedTasks =
  projection
    .createExecutionPathPresentation(
      observation(
        [],
        true,
      ),
      null,
    );

assert.equal(
  truncatedTasks.tasksObserved,
  true,
);

assert.equal(
  truncatedTasks.taskCollectionTruncated,
  true,
);


// ------------------------------------------------------------
// Freshness and transport semantics remain separated.
// ------------------------------------------------------------

assert.equal(
  (
    reactObservationSource.match(
      /window\.setInterval\(/g,
    )
    ?? []
  ).length,
  1,
  "UI Alpha must retain exactly one qualified freshness presentation ticker",
);

assert.equal(
  reactObservationSource.includes(
    "useObservationFreshnessSnapshot",
  ),
  true,
);

assert.equal(
  applicationObservationSource.includes(
    "() => performance.now()",
  ),
  true,
  "application boundary must retain explicit browser monotonic clock",
);

assert.equal(
  eventsPageSource.includes(
    "does not imply orchestrator execution failure",
  ),
  true,
);

assert.equal(
  eventsPageSource.includes(
    "does not represent SSE liveness",
  ),
  true,
);

assert.equal(
  serviceHealthSource.includes(
    "Observation stale",
  ),
  true,
);

assert.equal(
  serviceHealthSource.includes(
    "Observed · read-only",
  ),
  true,
);


// ------------------------------------------------------------
// Startup and lifecycle authority remain outside React pages.
// ------------------------------------------------------------

assert.equal(
  (
    mainSource.match(
      /applicationObservationSession\s*\.\s*start\s*\(\s*\)/g,
    )
    ?? []
  ).length,
  1,
  "UI Alpha must start application observation exactly once",
);

for (const forbidden of [
  ".continue(",
  ".stop(",
  "setInterval(",
  "setTimeout(",
  "useEffect(",
]) {
  assert.equal(
    mainSource.includes(
      forbidden,
    ),
    false,
    `main composition gained hidden lifecycle behavior ${forbidden}`,
  );
}


// ------------------------------------------------------------
// Alpha truthfulness constraints remain visible.
// ------------------------------------------------------------

for (const required of [
  "No current",
  "execution is inferred.",
  "Derived locally",
  "No task is auto-selected.",
]) {
  assert.equal(
    overviewSource.includes(
      required,
    ),
    true,
    `Overview Alpha truthfulness copy missing ${required}`,
  );
}

for (const required of [
  "No join is",
  "inferred from",
  "Older trusted",
  "events may be absent",
]) {
  assert.equal(
    taskPageSource.includes(
      required,
    ),
    true,
    `TaskPage Alpha observation-boundary copy missing ${required}`,
  );
}

const normalizedEventsPage =
  eventsPageSource.replace(
    /\s+/g,
    " ",
  );

for (const required of [
  "Not durable journal history",
  "does not sort by timestamp",
  "does not represent SSE liveness",
]) {
  assert.equal(
    normalizedEventsPage.includes(
      required,
    ),
    true,
    `EventsPage Alpha observation-boundary copy missing ${required}`,
  );
}


// ------------------------------------------------------------
// Permanent qualifier wiring.
// ------------------------------------------------------------

const mainQualifier =
  await readSource(
    "scripts",
    "qualify.mjs",
  );

assert.equal(
  (
    mainQualifier.match(
      /await import\("\.\/qualify-n16\.6\.mjs"\);/g,
    )
    ?? []
  ).length,
  1,
  "main UI qualifier must import N16.6 exactly once",
);


console.log(
  "PASS: N16.6 UI Alpha exposes exactly Overview, Task / Execution, and Event Timeline operator surfaces",
);

console.log(
  "PASS: N16.6 user-visible Alpha surfaces contain no obsolete milestone placeholders or deferral claims",
);

console.log(
  "PASS: N16.6 pages and presentation projections remain free of network, lifecycle, persistence, mutation, and approval authority",
);

console.log(
  "PASS: N16.6 Task / Execution preserves and visibly discloses bounded task-snapshot truncation",
);

console.log(
  "PASS: N16.6 task truncation semantics distinguish unobserved, complete, and truncated task collections",
);

console.log(
  "PASS: N16.6 retains exactly one qualified presentation-only freshness ticker and explicit monotonic clock injection",
);

console.log(
  "PASS: N16.6 preserves separation between observation staleness, transport state, observer integrity, and trusted execution state",
);

console.log(
  "PASS: N16.6 document composition retains one explicit observation startup with no hidden continuation or retry policy",
);

console.log(
  "PASS: N16.6 Alpha surfaces preserve explicit observation-boundary and non-inference disclosures",
);
