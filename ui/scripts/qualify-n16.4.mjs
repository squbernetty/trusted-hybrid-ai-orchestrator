// N16.4 SELECTED-TASK OBSERVED TRUST PATH QUALIFICATION

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
    "executionPathProjection.ts",
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
// Pure path projection has no authority-bearing behavior.
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
    `execution path projection gained forbidden authority ${forbidden}`,
  );
}


for (const required of [
  "ExecutionPathStage",
  "selectedTaskId",
  "selectedTask",
  "pathEvents",
  "retainedFirstEventSeq",
  "retainedLastEventSeq",
  "event.task_id",
  "=== selectedTaskId",
]) {
  assert.equal(
    projectionSource.includes(
      required,
    ),
    true,
    `execution path projection missing ${required}`,
  );
}


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
  taskId,
  status = "ADJUDICATE",
) {
  return {
    schema_version:
      "1.0",

    task_id:
      taskId,

    active_project:
      "qualification",

    task_class:
      "ENGINEERING",

    risk_level:
      "medium",

    reasoning_mode:
      "high",

    status,

    next_action:
      "supervisor_adjudicate",

    worker_calls_used:
      1,

    worker_calls_max:
      4,

    parallel_workers_active:
      0,

    local_runtime_seconds_used:
      12,

    cloud_worker_calls_used:
      0,

    checkpoint_last:
      null,

    checkpoint_resume_from:
      null,

    human_gate_status:
      null,

    human_gate_approval:
      null,
  };
}


function makeEvent(
  eventSeq,
  eventType,
  {
    taskId =
      "task-a",

    executionId =
      null,

    requestId =
      null,

    sourceClass =
      "trusted_core",
  } = {},
) {
  return {
    schema_version:
      "1.0",

    event_seq:
      eventSeq,

    event_id:
      `evt-${eventSeq}`,

    event_type:
      eventType,

    occurred_at:
      "2026-09-19T12:00:00Z",

    source_class:
      sourceClass,

    component:
      "qualification",

    task_id:
      taskId,

    execution_id:
      executionId,

    parent_execution_id:
      null,

    request_id:
      requestId,

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
      [],

    payload:
      {},
  };
}


function makeObservation(
  eventWindow,
) {
  return Object.freeze({
    observed:
      Object.freeze({
        health:
          null,

        tasks:
          Object.freeze({
            tasks:
              Object.freeze([
                makeTask(
                  "task-a",
                ),

                makeTask(
                  "task-b",
                  "DONE",
                ),
              ]),

            limit:
              100,

            truncated:
              false,
          }),

        eventTail:
          Object.freeze({
            events:
              Object.freeze(
                [...eventWindow],
              ),

            count:
              eventWindow.length,

            limit:
              100,
          }),

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
          eventWindow.at(-1)
            ?.event_seq
          ?? 0,
      }),
  });
}


// ------------------------------------------------------------
// No explicit selection means no path.
// ------------------------------------------------------------

{
  const result =
    projection
      .createExecutionPathPresentation(
        makeObservation([
          makeEvent(
            1,
            "routing.decided",
          ),
        ]),
        null,
      );

  assert.equal(
    result.selectedTaskId,
    null,
  );

  assert.equal(
    result.selectedTask,
    null,
  );

  assert.deepEqual(
    result.pathEvents,
    [],
  );

  assert.equal(
    Object.isFrozen(
      result,
    ),
    true,
  );
}


// ------------------------------------------------------------
// Exact task_id is the only correlation rule.
// Same request_id or execution_id cannot pull in an event that
// does not explicitly name the selected task.
// ------------------------------------------------------------

{
  const events = [
    makeEvent(
      10,
      "request.accepted",
      {
        taskId:
          null,

        requestId:
          "req-shared",
      },
    ),

    makeEvent(
      11,
      "routing.decided",
      {
        taskId:
          "task-a",

        requestId:
          "req-shared",
      },
    ),

    makeEvent(
      12,
      "execution.started",
      {
        taskId:
          "task-b",

        executionId:
          "x0001",

        requestId:
          "req-shared",

        sourceClass:
          "execution_supervisor",
      },
    ),

    makeEvent(
      13,
      "execution.started",
      {
        taskId:
          "task-a",

        executionId:
          "x0001",

        sourceClass:
          "execution_supervisor",
      },
    ),

    makeEvent(
      14,
      "verification.completed",
      {
        taskId:
          "task-a",

        sourceClass:
          "verification",
      },
    ),

    makeEvent(
      15,
      "approval.recorded",
      {
        taskId:
          "task-a",

        sourceClass:
          "human_authority",
      },
    ),

    makeEvent(
      16,
      "transition.accepted",
      {
        taskId:
          "task-a",
      },
    ),
  ];

  const result =
    projection
      .createExecutionPathPresentation(
        makeObservation(
          events,
        ),
        "task-a",
      );

  assert.equal(
    result.selectedTask.taskId,
    "task-a",
  );

  assert.deepEqual(
    result.pathEvents.map(
      (
        event,
      ) => (
        event.eventSeq
      ),
    ),
    [
      11,
      13,
      14,
      15,
      16,
    ],
  );

  assert.deepEqual(
    result.pathEvents.map(
      (
        event,
      ) => (
        event.stage
      ),
    ),
    [
      "routing",
      "execution",
      "verification",
      "approval",
      "transition",
    ],
  );

  assert.equal(
    result.pathEvents[1]
      .executionId,
    "x0001",
  );

  assert.equal(
    result.retainedFirstEventSeq,
    10,
  );

  assert.equal(
    result.retainedLastEventSeq,
    16,
  );

  assert.equal(
    result.retainedEventCount,
    7,
  );

  assert.equal(
    Object.isFrozen(
      result.pathEvents,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      result.pathEvents[0],
    ),
    true,
  );
}


// ------------------------------------------------------------
// Presentation stages preserve trusted event-domain vocabulary.
// Provider, model, budget, and approval remain distinct labels.
// ------------------------------------------------------------

{
  const result =
    projection
      .createExecutionPathPresentation(
        makeObservation([
          makeEvent(
            17,
            "provider.inventory_observed",
          ),

          makeEvent(
            18,
            "model.binding_selected",
          ),

          makeEvent(
            19,
            "budget.resolved",
          ),

          makeEvent(
            20,
            "approval.required",
            {
              sourceClass:
                "human_authority",
            },
          ),
        ]),
        "task-a",
      );

  assert.deepEqual(
    result.pathEvents.map(
      (
        event,
      ) => (
        event.stage
      ),
    ),
    [
      "provider",
      "model",
      "budget",
      "approval",
    ],
  );
}


// ------------------------------------------------------------
// Unknown event types remain evidence and are classified other.
// No hard-coded mandatory stage chain is fabricated.
// ------------------------------------------------------------

{
  const result =
    projection
      .createExecutionPathPresentation(
        makeObservation([
          makeEvent(
            20,
            "future.qualified_event",
          ),
        ]),
        "task-a",
      );

  assert.equal(
    result.pathEvents.length,
    1,
  );

  assert.equal(
    result.pathEvents[0].stage,
    "other",
  );
}


// ------------------------------------------------------------
// Task page owns explicit presentation selection only.
// ------------------------------------------------------------

for (const required of [
  "useObservationSnapshot",
  "useState",
  "selectedTaskId",
  "setSelectedTaskId",
  "Choose a task",
  "Explicit task selection",
  "createExecutionPathPresentation",
  "Exact task_id match",
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
    `TaskPage missing ${required}`,
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
  "localStorage",
  "sessionStorage",
  "history.",
  "location.",
]) {
  assert.equal(
    taskPageSource.includes(
      forbidden,
    ),
    false,
    `TaskPage gained forbidden authority ${forbidden}`,
  );
}


assert.match(
  taskPageSource,
  /useState<[\s\S]*?string \| null[\s\S]*?>\(\s*null,\s*\)/,
  "TaskPage must begin with no automatic task selection",
);


// ------------------------------------------------------------
// Functional path styling exists.
// ------------------------------------------------------------

for (const requiredStyle of [
  ".task-path-controls",
  ".task-path-selector",
  ".task-path-summary",
  ".task-path-panel",
  ".task-path-flow",
  ".task-path-step",
  ".task-path-step__card",
  ".task-path-boundary",
]) {
  assert.equal(
    stylesSource.includes(
      requiredStyle,
    ),
    true,
    `missing N16.4 style ${requiredStyle}`,
  );
}


// ------------------------------------------------------------
// Permanent qualifier wiring.
// ------------------------------------------------------------

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
      /await import\("\.\/qualify-n16\.4\.mjs"\);/g,
    )
    ?? []
  ).length,
  1,
  "main UI qualifier must import N16.4 exactly once",
);


console.log(
  "PASS: N16.4 requires explicit browser-local task selection and never auto-selects",
);

console.log(
  "PASS: N16.4 correlates path evidence only by exact trusted task_id match",
);

console.log(
  "PASS: N16.4 does not infer joins from request, execution, model, provider, timestamp, or adjacency",
);

console.log(
  "PASS: N16.4 preserves trusted event_seq order without fabricating mandatory stages",
);

console.log(
  "PASS: N16.4 preserves distinct provider, model, budget, execution, approval, and transition presentation domains",
);

console.log(
  "PASS: N16.4 retains execution identity only on events that explicitly carry execution_id",
);

console.log(
  "PASS: N16.4 unknown task-linked event types remain visible rather than silently discarded",
);

console.log(
  "PASS: N16.4 TaskPage owns presentation selection only and exposes no network, lifecycle, mutation, retry, timer, or persistence authority",
);

console.log(
  "PASS: N16.4 explicitly discloses the bounded browser event-window observation limit",
);
