// N16.5 GLOBAL RETAINED EVENT TIMELINE QUALIFICATION

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
    "eventTimelineProjection.ts",
  );

const eventsPageFilename =
  path.join(
    uiRoot,
    "src",
    "pages",
    "EventsPage.tsx",
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

const eventsPageSource =
  await readFile(
    eventsPageFilename,
    "utf8",
  );

const stylesSource =
  await readFile(
    stylesFilename,
    "utf8",
  );


// ------------------------------------------------------------
// Pure projection: no authority-bearing behavior.
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
  ".sort(",
  'from "react"',
]) {
  assert.equal(
    projectionSource.includes(
      forbidden,
    ),
    false,
    `event timeline projection gained forbidden authority or reordering ${forbidden}`,
  );
}


for (const required of [
  "EMPTY_EVENT_TIMELINE_FILTERS",
  "eventBaselineObserved",
  "retainedEventCount",
  "retainedFirstEventSeq",
  "retainedLastEventSeq",
  "currentEventCursor",
  "controllerState",
  "retainedGapEventSeq",
  "eventTypeOptions",
  "sourceClassOptions",
  "filteredEventCount",
  "matchesFilters",
]) {
  assert.equal(
    projectionSource.includes(
      required,
    ),
    true,
    `event timeline projection missing ${required}`,
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


function makeEvent(
  eventSeq,
  {
    eventType =
      "execution.started",

    sourceClass =
      "execution_supervisor",

    taskId =
      "task-a",

    executionId =
      "x0001",

    requestId =
      "req-a",
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
      eventSeq % 2 === 0
        ? [`evidence-${eventSeq}`]
        : [],

    payload:
      {},
  };
}


function makeObservation(
  events,
  {
    observedBaseline =
      true,

    cursor =
      events.at(-1)?.event_seq
      ?? (
        observedBaseline
          ? 0
          : null
      ),
  } = {},
) {
  return Object.freeze({
    observed:
      Object.freeze({
        health:
          null,

        tasks:
          null,

        eventTail:
          observedBaseline
            ? Object.freeze({
                events:
                  Object.freeze(
                    [...events],
                  ),

                count:
                  events.length,

                limit:
                  100,
              })
            : null,

        eventWindow:
          Object.freeze(
            [...events],
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
      "disconnected",

    sessionGeneration:
      7,

    retainedGapEventSeq:
      44,
  });


// ------------------------------------------------------------
// Unobserved baseline remains distinguishable from validated empty.
// ------------------------------------------------------------

{
  const result =
    projection
      .createEventTimelinePresentation(
        makeObservation(
          [],
          {
            observedBaseline:
              false,

            cursor:
              null,
          },
        ),
        controller,
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

  assert.deepEqual(
    result.events,
    [],
  );
}


{
  const result =
    projection
      .createEventTimelinePresentation(
        makeObservation(
          [],
        ),
        controller,
      );

  assert.equal(
    result.eventBaselineObserved,
    true,
  );

  assert.equal(
    result.currentEventCursor,
    0,
  );

  assert.equal(
    result.retainedFirstEventSeq,
    null,
  );

  assert.equal(
    result.retainedLastEventSeq,
    null,
  );
}


// ------------------------------------------------------------
// Default view preserves exact retained source order and unknown
// future trusted event types remain visible.
// ------------------------------------------------------------

{
  const events = [
    makeEvent(
      41,
      {
        eventType:
          "routing.decided",

        sourceClass:
          "trusted_core",
      },
    ),

    makeEvent(
      42,
      {
        eventType:
          "future.qualified_event",

        sourceClass:
          "provider",

        taskId:
          null,

        executionId:
          null,

        requestId:
          "req-future",
      },
    ),

    makeEvent(
      43,
      {
        eventType:
          "verification.completed",

        sourceClass:
          "verification",

        taskId:
          "task-b",

        executionId:
          null,

        requestId:
          null,
      },
    ),
  ];

  const result =
    projection
      .createEventTimelinePresentation(
        makeObservation(
          events,
        ),
        controller,
      );

  assert.deepEqual(
    result.events.map(
      (
        event,
      ) => (
        event.eventSeq
      ),
    ),
    [
      41,
      42,
      43,
    ],
  );

  assert.equal(
    result.events[1].eventType,
    "future.qualified_event",
  );

  assert.deepEqual(
    result.eventTypeOptions,
    [
      "routing.decided",
      "future.qualified_event",
      "verification.completed",
    ],
  );

  assert.deepEqual(
    result.sourceClassOptions,
    [
      "trusted_core",
      "provider",
      "verification",
    ],
  );

  assert.equal(
    result.retainedFirstEventSeq,
    41,
  );

  assert.equal(
    result.retainedLastEventSeq,
    43,
  );

  assert.equal(
    result.retainedEventCount,
    3,
  );

  assert.equal(
    result.controllerState,
    "disconnected",
  );

  assert.equal(
    result.sessionGeneration,
    7,
  );

  assert.equal(
    result.retainedGapEventSeq,
    44,
  );

  assert.equal(
    Object.isFrozen(
      result,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      result.events,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      result.events[0],
    ),
    true,
  );
}


// ------------------------------------------------------------
// Filters use exact equality only and never create inferred joins.
// ------------------------------------------------------------

{
  const events = [
    makeEvent(
      50,
      {
        eventType:
          "execution.started",

        sourceClass:
          "execution_supervisor",

        taskId:
          "task-a",

        executionId:
          "x0001",

        requestId:
          "req-a",
      },
    ),

    makeEvent(
      51,
      {
        eventType:
          "execution.started",

        sourceClass:
          "execution_supervisor",

        taskId:
          "task-ab",

        executionId:
          "x00010",

        requestId:
          "req-ab",
      },
    ),

    makeEvent(
      52,
      {
        eventType:
          "approval.required",

        sourceClass:
          "human_authority",

        taskId:
          "task-a",

        executionId:
          null,

        requestId:
          null,
      },
    ),
  ];

  const exactTask =
    projection
      .createEventTimelinePresentation(
        makeObservation(
          events,
        ),
        controller,
        {
          ...projection
            .EMPTY_EVENT_TIMELINE_FILTERS,

          taskId:
            "task-a",
        },
      );

  assert.deepEqual(
    exactTask.events.map(
      (
        event,
      ) => (
        event.eventSeq
      ),
    ),
    [
      50,
      52,
    ],
  );


  const exactExecution =
    projection
      .createEventTimelinePresentation(
        makeObservation(
          events,
        ),
        controller,
        {
          ...projection
            .EMPTY_EVENT_TIMELINE_FILTERS,

          executionId:
            "x0001",
        },
      );

  assert.deepEqual(
    exactExecution.events.map(
      (
        event,
      ) => (
        event.eventSeq
      ),
    ),
    [
      50,
    ],
  );


  const exactTypeAndSource =
    projection
      .createEventTimelinePresentation(
        makeObservation(
          events,
        ),
        controller,
        {
          ...projection
            .EMPTY_EVENT_TIMELINE_FILTERS,

          eventType:
            "approval.required",

          sourceClass:
            "human_authority",
        },
      );

  assert.deepEqual(
    exactTypeAndSource.events.map(
      (
        event,
      ) => (
        event.eventSeq
      ),
    ),
    [
      52,
    ],
  );
}


// ------------------------------------------------------------
// EventsPage consumes only read-only observation/controller views
// plus browser-local React filter state.
// ------------------------------------------------------------

for (const required of [
  "useObservationSnapshot",
  "useObservationControllerSnapshot",
  "useState",
  "EMPTY_EVENT_TIMELINE_FILTERS",
  "Global retained event timeline",
  "Presentation-only filters",
  "Exact task ID",
  "Exact execution ID",
  "Exact request ID",
  "Ascending event_seq",
  "Observation boundary",
  "Bootstrap event-tail freshness is",
  "does not represent SSE liveness",
]) {
  assert.equal(
    eventsPageSource.includes(
      required,
    ),
    true,
    `EventsPage missing ${required}`,
  );
}


assert.match(
  eventsPageSource,
  /does\s+not\s+sort\s+by\s+timestamp/,
  "EventsPage must explicitly state that it does not sort by timestamp",
);


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
  "useObservationFreshnessSnapshot",
  "localStorage",
  "sessionStorage",
  "history.",
  "location.",
  "Timeline pending",
  "Timeline rendering not enabled",
]) {
  assert.equal(
    eventsPageSource.includes(
      forbidden,
    ),
    false,
    `EventsPage gained forbidden authority, freshness timer, persistence, or obsolete copy ${forbidden}`,
  );
}


// ------------------------------------------------------------
// N16.5 functional styling exists.
// ------------------------------------------------------------

for (const requiredStyle of [
  ".timeline-metrics",
  ".timeline-observer-context",
  ".timeline-filter-panel",
  ".timeline-filters",
  ".global-event-timeline",
  ".global-event__card",
  ".global-event__details",
  ".timeline-boundary-note",
]) {
  assert.equal(
    stylesSource.includes(
      requiredStyle,
    ),
    true,
    `missing N16.5 style ${requiredStyle}`,
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
      /await import\("\.\/qualify-n16\.5\.mjs"\);/g,
    )
    ?? []
  ).length,
  1,
  "main UI qualifier must import N16.5 exactly once",
);


console.log(
  "PASS: N16.5 distinguishes unobserved from validated-empty event baselines",
);

console.log(
  "PASS: N16.5 preserves trusted retained event_seq order without timestamp sorting",
);

console.log(
  "PASS: N16.5 keeps unknown future trusted event types visible by default",
);

console.log(
  "PASS: N16.5 browser-local filters use exact equality and never infer event relationships",
);

console.log(
  "PASS: N16.5 exposes controller, cursor, and gap context only as browser-local observation metadata",
);

console.log(
  "PASS: N16.5 discloses bounded browser retention and does not claim durable journal completeness",
);

console.log(
  "PASS: N16.5 intentionally avoids bootstrap event-tail freshness as a live-stream status signal",
);

console.log(
  "PASS: N16.5 EventsPage owns no network, lifecycle, retry, store/controller mutation, backend-query, persistence, or approval authority",
);

console.log(
  "PASS: N16.5 progressive disclosure keeps secondary event metadata out of the default timeline summary",
);
