// N16.3b FUNCTIONAL OVERVIEW QUALIFICATION

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


const projectionFilename =
  path.join(
    uiRoot,
    "src",
    "presentation",
    "overviewProjection.ts",
  );

const overviewFilename =
  path.join(
    uiRoot,
    "src",
    "pages",
    "OverviewPage.tsx",
  );

const taskPageFilename =
  path.join(
    uiRoot,
    "src",
    "pages",
    "TaskPage.tsx",
  );

const stylesFilename =
  path.join(
    uiRoot,
    "src",
    "styles.css",
  );


const projectionSource =
  await readFile(
    projectionFilename,
    "utf8",
  );

const overviewSource =
  await readFile(
    overviewFilename,
    "utf8",
  );

const taskPageSource =
  await readFile(
    taskPageFilename,
    "utf8",
  );

const stylesSource =
  await readFile(
    stylesFilename,
    "utf8",
  );


// ------------------------------------------------------------
// Pure presentation projection: no authority-bearing behavior.
// ------------------------------------------------------------

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
  "Date.now(",
  "performance.now(",
  'from "react"',
]) {
  assert.equal(
    projectionSource.includes(
      forbidden,
    ),
    false,
    `overview projection gained forbidden authority ${forbidden}`,
  );
}


for (const required of [
  "OVERVIEW_TASK_DISPLAY_LIMIT",
  "OVERVIEW_EVENT_DISPLAY_LIMIT",
  "tasksObserved",
  "eventBaselineObserved",
  "currentEventCursor",
  "controllerState",
  "retainedGapEventSeq",
]) {
  assert.equal(
    projectionSource.includes(
      required,
    ),
    true,
    `overview projection missing ${required}`,
  );
}


// Type-only imports disappear during transpilation.
const projectionTranspiled =
  ts.transpileModule(
    projectionSource,
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
      projectionTranspiled,
    ),
  );


function makeTask(
  index,
) {
  return {
    schema_version:
      "1.0",

    task_id:
      `task-${String(index).padStart(3, "0")}`,

    active_project:
      "qualification",

    task_class:
      "ENGINEERING",

    risk_level:
      index % 2 === 0
        ? "medium"
        : "low",

    reasoning_mode:
      "high",

    status:
      `STATUS_${index}`,

    next_action:
      `action_${index}`,

    worker_calls_used:
      index,

    worker_calls_max:
      10,

    parallel_workers_active:
      0,

    local_runtime_seconds_used:
      index * 2,

    cloud_worker_calls_used:
      0,

    checkpoint_last:
      null,

    checkpoint_resume_from:
      null,

    human_gate_status:
      index === 1
        ? "pending"
        : null,

    human_gate_approval:
      index === 1
        ? "COMMIT"
        : null,
  };
}


function makeEvent(
  eventSeq,
) {
  return {
    schema_version:
      "1.0",

    event_seq:
      eventSeq,

    event_id:
      `evt-${eventSeq}`,

    event_type:
      `qualification.event.${eventSeq}`,

    occurred_at:
      "2026-09-19T12:00:00Z",

    source_class:
      "trusted_core",

    component:
      "qualification",

    task_id:
      "task-001",

    execution_id:
      `x${eventSeq}`,

    parent_execution_id:
      null,

    request_id:
      null,

    worker_role:
      null,

    provider_id:
      null,

    model_id:
      null,

    state_before:
      null,

    state_after:
      null,

    reason_code:
      null,

    evidence_refs:
      eventSeq % 2 === 0
        ? [
            `evidence-${eventSeq}`,
          ]
        : [],

    payload:
      {},
  };
}


function makeObservation({
  tasks = null,
  eventTail = null,
  eventWindow = [],
  cursor = null,
} = {}) {
  return Object.freeze({
    observed:
      Object.freeze({
        health:
          null,

        tasks,

        eventTail,

        eventWindow:
          Object.freeze(
            [...eventWindow],
          ),
      }),

    derived:
      Object.freeze({
        bootstrapEventCursor:
          null,

        currentEventCursor:
          cursor,
      }),
  });
}


const controller =
  Object.freeze({
    state:
      "streaming",

    sessionGeneration:
      3,

    retainedGapEventSeq:
      null,
  });


// No observations must remain distinguishable from validated empty
// observations.
{
  const result =
    projection
      .createOverviewPresentation(
        makeObservation(),
        controller,
      );

  assert.equal(
    result.tasksObserved,
    false,
  );

  assert.equal(
    result.taskCount,
    null,
  );

  assert.equal(
    result.eventBaselineObserved,
    false,
  );

  assert.equal(
    result.retainedEventCount,
    0,
  );

  assert.equal(
    result.currentEventCursor,
    null,
  );

  assert.equal(
    result.controllerState,
    "streaming",
  );

  assert.equal(
    result.sessionGeneration,
    3,
  );

  assert.equal(
    Object.isFrozen(
      result,
    ),
    true,
  );
}


// Validated empty task/event snapshots remain observed.
{
  const result =
    projection
      .createOverviewPresentation(
        makeObservation({
          tasks:
            Object.freeze({
              tasks:
                Object.freeze([]),

              limit:
                100,

              truncated:
                false,
            }),

          eventTail:
            Object.freeze({
              events:
                Object.freeze([]),

              count:
                0,

              limit:
                100,
            }),

          cursor:
            0,
        }),
        controller,
      );

  assert.equal(
    result.tasksObserved,
    true,
  );

  assert.equal(
    result.taskCount,
    0,
  );

  assert.equal(
    result.eventBaselineObserved,
    true,
  );

  assert.equal(
    result.retainedEventCount,
    0,
  );

  assert.equal(
    result.currentEventCursor,
    0,
  );
}


// Bounded presentation keeps source order and never auto-selects a task.
{
  const tasks =
    Array.from(
      {
        length:
          8,
      },
      (
        _value,
        index,
      ) => (
        makeTask(
          index + 1,
        )
      ),
    );

  const events =
    Array.from(
      {
        length:
          8,
      },
      (
        _value,
        index,
      ) => (
        makeEvent(
          index + 1,
        )
      ),
    );

  const result =
    projection
      .createOverviewPresentation(
        makeObservation({
          tasks:
            Object.freeze({
              tasks:
                Object.freeze(
                  tasks,
                ),

              limit:
                100,

              truncated:
                true,
            }),

          eventTail:
            Object.freeze({
              events:
                Object.freeze(
                  events,
                ),

              count:
                8,

              limit:
                100,
            }),

          eventWindow:
            events,

          cursor:
            8,
        }),

        Object.freeze({
          state:
            "repairing",

          sessionGeneration:
            4,

          retainedGapEventSeq:
            12,
        }),
      );

  assert.equal(
    result.taskCount,
    8,
  );

  assert.equal(
    result.taskCollectionTruncated,
    true,
  );

  assert.equal(
    result.taskItems.length,
    6,
  );

  assert.deepEqual(
    result.taskItems.map(
      (item) => (
        item.taskId
      ),
    ),
    [
      "task-001",
      "task-002",
      "task-003",
      "task-004",
      "task-005",
      "task-006",
    ],
  );

  assert.equal(
    result.eventItems.length,
    6,
  );

  assert.deepEqual(
    result.eventItems.map(
      (item) => (
        item.eventSeq
      ),
    ),
    [
      3,
      4,
      5,
      6,
      7,
      8,
    ],
  );

  assert.equal(
    result.eventItems[1]
      .evidenceCount,
    1,
  );

  assert.equal(
    result.controllerState,
    "repairing",
  );

  assert.equal(
    result.retainedGapEventSeq,
    12,
  );

  assert.equal(
    Object.isFrozen(
      result.taskItems,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      result.taskItems[0],
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      result.eventItems,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      result.eventItems[0],
    ),
    true,
  );

  for (const forbiddenKey of [
    "selectedTask",
    "currentTask",
    "currentExecution",
    "estimatedRemaining",
    "modelBinding",
  ]) {
    assert.equal(
      Object.hasOwn(
        result,
        forbiddenKey,
      ),
      false,
      `overview projection must not invent ${forbiddenKey}`,
    );
  }
}


// ------------------------------------------------------------
// Overview page consumes only qualified read-only React views.
// ------------------------------------------------------------

for (const required of [
  "useObservationSnapshot",
  "useObservationControllerSnapshot",
  "createOverviewPresentation",
  "Observation overview",
  "No current",
  "execution is inferred.",
  "Browser cursor",
  "Derived locally",
  "No task is auto-selected.",
  "Recent trusted events",
]) {
  assert.equal(
    overviewSource.includes(
      required,
    ),
    true,
    `OverviewPage missing ${required}`,
  );
}


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
  "useEffect(",
  "useState(",
  "No execution loaded",
  "Task and event ingestion",
  "Estimated remaining",
  "Execution path",
]) {
  assert.equal(
    overviewSource.includes(
      forbidden,
    ),
    false,
    `OverviewPage contains forbidden or premature behavior/copy ${forbidden}`,
  );
}


// N16.3b's enduring TaskPage invariant is the absence of
// obsolete N16.2 deferral copy. Later qualified milestones may
// replace the temporary N16.3b TaskPage placeholder.
assert.equal(
  taskPageSource.includes(
    "intentionally deferred to N16.2",
  ),
  false,
);

assert.equal(
  taskPageSource.includes(
    "Task discovery and observation",
  ),
  false,
);


// Required functional overview styling exists.
for (const requiredStyle of [
  ".overview-metrics",
  ".metric-card",
  ".overview-detail-grid",
  ".observation-panel",
  ".observation-table",
  ".event-evidence-list",
  ".overview-authority-note",
]) {
  assert.equal(
    stylesSource.includes(
      requiredStyle,
    ),
    true,
    `missing N16.3b style ${requiredStyle}`,
  );
}


// Permanent qualifier wiring.
const mainQualifier =
  await readFile(
    path.join(
      uiRoot,
      "scripts",
      "qualify.mjs",
    ),
    "utf8",
  );

assert.equal(
  (
    mainQualifier.match(
      /await import\("\.\/qualify-n16\.3b\.mjs"\);/g,
    )
    ?? []
  ).length,
  1,
  "main UI qualifier must import N16.3b exactly once",
);


console.log(
  "PASS: N16.3b overview projection distinguishes unobserved from validated-empty sources",
);

console.log(
  "PASS: N16.3b overview projection bounds task and event presentation without auto-selecting a task",
);

console.log(
  "PASS: N16.3b browser controller state and cursor remain explicitly presentation metadata",
);

console.log(
  "PASS: N16.3b overview consumes only qualified read-only React observation views",
);

console.log(
  "PASS: N16.3b overview exposes no network, lifecycle, mutation, retry, timer, or authority-bearing behavior",
);

console.log(
  "PASS: N16.3b does not infer current execution, ETA, model binding, or unobserved approval",
);

console.log(
  "PASS: N16.3b task page no longer contains obsolete N16.2 deferral copy",
);

console.log(
  "PASS: N16.3b functional overview styling contract is present",
);
