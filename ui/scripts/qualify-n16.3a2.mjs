// N16.3a2 APPLICATION OBSERVATION SESSION QUALIFICATION

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tsModule = await import("typescript");
const ts = tsModule.default ?? tsModule;

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


function transpile(
  source,
) {
  return ts
    .transpileModule(
      source,
      {
        compilerOptions: {
          target:
            ts.ScriptTarget.ES2022,

          module:
            ts.ModuleKind.ES2022,
        },
      },
    )
    .outputText;
}


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


const applicationFilename =
  path.join(
    uiRoot,
    "src",
    "app",
    "applicationObservation.ts",
  );


const applicationSource =
  await readFile(
    applicationFilename,
    "utf8",
  );


const bootstrapStubUrl =
  moduleUrl(
    [
      "export {};",
    ].join("\n"),
  );


const freshnessStubSource = `
  const records = [];

  export function createObservationFreshnessTracker(
    policy,
    clock,
  ) {
    const record = {
      policy,
      clock,
      marks: [],
      resets: 0,
    };

    const tracker = Object.freeze({
      markObserved(source) {
        record.marks.push(source);
      },

      getSnapshot() {
        return Object.freeze({
          health: Object.freeze({
            state: "unobserved",
            lastObservedAtMs: null,
            ageMs: null,
            maxAgeMs: policy.healthMaxAgeMs,
          }),

          tasks: Object.freeze({
            state: "unobserved",
            lastObservedAtMs: null,
            ageMs: null,
            maxAgeMs: policy.tasksMaxAgeMs,
          }),

          eventTail: Object.freeze({
            state: "unobserved",
            lastObservedAtMs: null,
            ageMs: null,
            maxAgeMs: policy.eventTailMaxAgeMs,
          }),
        });
      },

      reset() {
        record.resets += 1;
      },
    });

    record.tracker = tracker;
    records.push(record);
    return tracker;
  }

  export function __records() {
    return records;
  }
`;


const freshnessStubUrl =
  moduleUrl(
    freshnessStubSource,
  );


const runtimeStubSource = `
  const records = [];

  let bootstrapImplementation =
    async () => ({
      outcome: "complete",
      sources: {
        health: "observed",
        tasks: "observed",
        eventTail: "observed",
      },
    });

  export function __setBootstrapImplementation(
    implementation,
  ) {
    bootstrapImplementation =
      implementation;
  }

  export function __records() {
    return records;
  }

  export function __latestStore() {
    return records.at(-1)?.store ?? null;
  }

  export function createObservationRuntime(
    readers,
    freshnessTracker,
  ) {
    let snapshot =
      Object.freeze({
        observed: Object.freeze({}),
        derived: Object.freeze({
          currentEventCursor: null,
        }),
      });

    const listeners =
      new Set();

    const store =
      Object.freeze({
        getSnapshot() {
          return snapshot;
        },

        dispatch(action) {
          snapshot =
            Object.freeze({
              observed:
                Object.freeze({
                  action,
                }),

              derived:
                Object.freeze({
                  currentEventCursor:
                    null,
                }),
            });

          for (const listener of [...listeners]) {
            listener();
          }
        },

        subscribe(listener) {
          listeners.add(listener);

          let subscribed =
            true;

          return () => {
            if (!subscribed) {
              return;
            }

            subscribed =
              false;

            listeners.delete(listener);
          };
        },
      });

    const record = {
      readers,
      freshnessTracker,
      store,
      bootstrapCalls: [],
    };

    records.push(record);

    return Object.freeze({
      store,

      freshness:
        freshnessTracker === undefined
          ? null
          : Object.freeze({
              getSnapshot:
                freshnessTracker.getSnapshot,
            }),

      async bootstrap(signal) {
        record.bootstrapCalls.push(signal);

        return bootstrapImplementation(
          signal,
          store,
          freshnessTracker,
        );
      },
    });
  }
`;


const runtimeStubUrl =
  moduleUrl(
    runtimeStubSource,
  );


const controllerStubSource = `
  const records = [];

  export function __records() {
    return records;
  }

  export function createObservationController(
    store,
  ) {
    let snapshot =
      Object.freeze({
        state: "idle",
        sessionGeneration: 0,
        retainedGapEventSeq: null,
      });

    const listeners =
      new Set();

    const record = {
      store,
      startCount: 0,
      continueCount: 0,
      stopCount: 0,
    };

    records.push(record);

    function publish(nextState) {
      snapshot =
        Object.freeze({
          ...snapshot,
          state:
            nextState,
        });

      for (const listener of [...listeners]) {
        try {
          listener();
        }
        catch {
          continue;
        }
      }
    }

    return Object.freeze({
      getSnapshot() {
        return snapshot;
      },

      subscribe(listener) {
        listeners.add(listener);

        let subscribed =
          true;

        return () => {
          if (!subscribed) {
            return;
          }

          subscribed =
            false;

          listeners.delete(listener);
        };
      },

      start() {
        if (snapshot.state !== "idle") {
          throw new TypeError(
            "controller can only start from idle",
          );
        }

        record.startCount += 1;

        snapshot =
          Object.freeze({
            state: "streaming",
            sessionGeneration:
              snapshot.sessionGeneration + 1,
            retainedGapEventSeq: null,
          });

        for (const listener of [...listeners]) {
          try {
            listener();
          }
          catch {
            continue;
          }
        }
      },

      async continue() {
        record.continueCount += 1;
      },

      stop() {
        if (snapshot.state === "stopped") {
          return;
        }

        record.stopCount += 1;
        publish("stopped");
      },
    });
  }
`;


const controllerStubUrl =
  moduleUrl(
    controllerStubSource,
  );


const storeStubUrl =
  moduleUrl(
    [
      "export {};",
    ].join("\n"),
  );


const preparedApplication =
  applicationSource
    .replace(
      '"../state/bootstrapCoordinator"',
      JSON.stringify(
        bootstrapStubUrl,
      ),
    )
    .replace(
      '"../state/observationController"',
      JSON.stringify(
        controllerStubUrl,
      ),
    )
    .replace(
      '"../state/observationFreshness"',
      JSON.stringify(
        freshnessStubUrl,
      ),
    )
    .replace(
      '"../state/observationRuntime"',
      JSON.stringify(
        runtimeStubUrl,
      ),
    )
    .replace(
      '"../state/observationStore"',
      JSON.stringify(
        storeStubUrl,
      ),
    );


const applicationUrl =
  moduleUrl(
    transpile(
      preparedApplication,
    ),
  );


const freshnessStub =
  await import(
    freshnessStubUrl,
  );

const runtimeStub =
  await import(
    runtimeStubUrl,
  );

const controllerStub =
  await import(
    controllerStubUrl,
  );

const application =
  await import(
    applicationUrl,
  );


function controllerRecordFor(
  sessionIndex,
) {
  return controllerStub
    .__records()[
      sessionIndex
    ];
}


function runtimeRecordFor(
  sessionIndex,
) {
  return runtimeStub
    .__records()[
      sessionIndex
    ];
}


// ------------------------------------------------------------
// Static application-boundary contract.
// ------------------------------------------------------------

for (const required of [
  "APPLICATION_OBSERVATION_FRESHNESS_POLICY",
  "createObservationFreshnessTracker",
  "createObservationRuntime",
  "createObservationController",
  "performance.now()",
  "runtime.bootstrap",
  "controller.start",
  "controller.continue",
  "controller.stop",
  "applicationObservationSession",
]) {
  assert.equal(
    applicationSource.includes(
      required,
    ),
    true,
    `application observation composition missing ${required}`,
  );
}


for (const forbidden of [
  "fetch(",
  "EventSource(",
  "WebSocket(",
  "XMLHttpRequest",
  "setTimeout(",
  "setInterval(",
  "Date.now(",
  "useEffect(",
  "useState(",
  "useSyncExternalStore(",
  'from "react"',
  ".dispatch(",
  ".markObserved(",
  ".reset(",
]) {
  assert.equal(
    applicationSource.includes(
      forbidden,
    ),
    false,
    `application observation composition gained forbidden responsibility ${forbidden}`,
  );
}


assert.equal(
  (
    applicationSource.match(
      /\bperformance\.now\s*\(/g,
    )
    ?? []
  ).length >= 1,
  true,
  "application boundary must inject the browser monotonic-clock source",
);


assert.equal(
  (
    applicationSource.match(
      /\bcreateObservationController\s*\(/g,
    )
    ?? []
  ).length,
  1,
);


assert.equal(
  (
    applicationSource.match(
      /\bcreateObservationRuntime\s*\(/g,
    )
    ?? []
  ).length,
  1,
);


assert.equal(
  (
    applicationSource.match(
      /\bcreateObservationFreshnessTracker\s*\(/g,
    )
    ?? []
  ).length,
  1,
);


// ------------------------------------------------------------
// Construction is side-effect free with respect to observation
// execution.
// ------------------------------------------------------------

const singletonRuntime =
  runtimeRecordFor(
    0,
  );

const singletonController =
  controllerRecordFor(
    0,
  );


assert.equal(
  singletonRuntime.bootstrapCalls.length,
  0,
);

assert.equal(
  singletonController.startCount,
  0,
);

assert.equal(
  singletonController.continueCount,
  0,
);

assert.equal(
  singletonController.stopCount,
  0,
);


// ------------------------------------------------------------
// Freshness policy and monotonic clock are selected exactly at
// the application boundary.
// ------------------------------------------------------------

assert.deepEqual(
  application
    .APPLICATION_OBSERVATION_FRESHNESS_POLICY,
  {
    healthMaxAgeMs:
      30_000,

    tasksMaxAgeMs:
      30_000,

    eventTailMaxAgeMs:
      30_000,
  },
);


assert.equal(
  Object.isFrozen(
    application
      .APPLICATION_OBSERVATION_FRESHNESS_POLICY,
  ),
  true,
);


const singletonFreshnessRecord =
  freshnessStub
    .__records()[
      0
    ];


assert.strictEqual(
  singletonRuntime
    .freshnessTracker,
  freshnessStub
    .__records()[
      0
    ]
    .tracker,
  "application runtime must receive the exact application-owned freshness tracker",
);


const clockReading =
  singletonFreshnessRecord
    .clock();


assert.equal(
  typeof clockReading,
  "number",
);

assert.equal(
  Number.isFinite(
    clockReading,
  ),
  true,
);

assert.equal(
  clockReading >= 0,
  true,
);


// ------------------------------------------------------------
// Runtime and controller share the exact same store.
// Public views do not expose mutation/lifecycle authority.
// ------------------------------------------------------------

assert.strictEqual(
  singletonController.store,
  singletonRuntime.store,
);


const singleton =
  application
    .applicationObservationSession;


assert.equal(
  Object.isFrozen(
    singleton,
  ),
  true,
);

assert.equal(
  Object.isFrozen(
    singleton.observations,
  ),
  true,
);

assert.equal(
  Object.isFrozen(
    singleton.controller,
  ),
  true,
);


assert.equal(
  Object.hasOwn(
    singleton.observations,
    "dispatch",
  ),
  false,
);


for (const forbiddenMethod of [
  "start",
  "continue",
  "stop",
]) {
  assert.equal(
    Object.hasOwn(
      singleton.controller,
      forbiddenMethod,
    ),
    false,
  );
}


assert.deepEqual(
  Object.keys(
    singleton.freshness,
  ),
  [
    "getSnapshot",
  ],
);


// ------------------------------------------------------------
// Presentation subscriber faults cannot escape through the
// ObservationStore subscription boundary.
// ------------------------------------------------------------

{
  let goodNotifications =
    0;

  singleton
    .observations
    .subscribe(
      () => {
        throw new Error(
          "qualification presentation failure",
        );
      },
    );

  singleton
    .observations
    .subscribe(
      () => {
        goodNotifications +=
          1;
      },
    );


  assert.doesNotThrow(
    () => {
      singletonRuntime
        .store
        .dispatch({
          type:
            "qualification",
        });
    },
  );


  assert.equal(
    goodNotifications,
    1,
  );
}


// ------------------------------------------------------------
// Valid event-tail bootstrap starts observation exactly once.
// Health/tasks may remain partial independently.
// ------------------------------------------------------------

{
  const session =
    application
      .createApplicationObservationSession();

  const index =
    controllerStub
      .__records()
      .length
    - 1;

  const runtimeRecord =
    runtimeRecordFor(
      index,
    );

  const controllerRecord =
    controllerRecordFor(
      index,
    );


  runtimeStub
    .__setBootstrapImplementation(
      async () => ({
        outcome:
          "partial",

        sources: {
          health:
            "failed",

          tasks:
            "observed",

          eventTail:
            "observed",
        },
      }),
    );


  const result =
    await session.start();


  assert.equal(
    result.outcome,
    "partial",
  );

  assert.equal(
    runtimeRecord
      .bootstrapCalls
      .length,
    1,
  );

  assert.equal(
    controllerRecord
      .startCount,
    1,
  );

  assert.equal(
    controllerRecord
      .continueCount,
    0,
  );
}


// ------------------------------------------------------------
// Missing event-tail baseline does not start SSE and may be
// retried only by another explicit start().
// ------------------------------------------------------------

{
  const session =
    application
      .createApplicationObservationSession();

  const index =
    controllerStub
      .__records()
      .length
    - 1;

  const controllerRecord =
    controllerRecordFor(
      index,
    );

  let attempts =
    0;


  runtimeStub
    .__setBootstrapImplementation(
      async () => {
        attempts +=
          1;

        if (
          attempts === 1
        ) {
          return {
            outcome:
              "partial",

            sources: {
              health:
                "observed",

              tasks:
                "observed",

              eventTail:
                "failed",
            },
          };
        }

        return {
          outcome:
            "complete",

          sources: {
            health:
              "observed",

            tasks:
              "observed",

            eventTail:
              "observed",
          },
        };
      },
    );


  const first =
    await session.start();


  assert.equal(
    first
      .sources
      .eventTail,
    "failed",
  );

  assert.equal(
    controllerRecord.startCount,
    0,
  );


  const second =
    await session.start();


  assert.equal(
    second
      .sources
      .eventTail,
    "observed",
  );

  assert.equal(
    controllerRecord.startCount,
    1,
  );
}


// ------------------------------------------------------------
// Concurrent bootstrap is rejected rather than creating
// competing application lifecycle attempts.
// ------------------------------------------------------------

{
  const session =
    application
      .createApplicationObservationSession();

  let resolveBootstrap;

  runtimeStub
    .__setBootstrapImplementation(
      () => (
        new Promise(
          (resolve) => {
            resolveBootstrap =
              resolve;
          },
        )
      ),
    );


  const firstStart =
    session.start();


  await assert.rejects(
    () => session.start(),
    TypeError,
  );


  session.stop();


  resolveBootstrap({
    outcome:
      "aborted",

    sources: {
      health:
        "aborted",

      tasks:
        "not_attempted",

      eventTail:
        "not_attempted",
    },
  });


  await firstStart;
}


// ------------------------------------------------------------
// stop() during bootstrap aborts the owned signal and prevents
// later controller start even if the reader resolves.
// ------------------------------------------------------------

{
  const session =
    application
      .createApplicationObservationSession();

  const index =
    controllerStub
      .__records()
      .length
    - 1;

  const controllerRecord =
    controllerRecordFor(
      index,
    );

  let capturedSignal;
  let resolveBootstrap;


  runtimeStub
    .__setBootstrapImplementation(
      (
        signal,
      ) => {
        capturedSignal =
          signal;

        return new Promise(
          (resolve) => {
            resolveBootstrap =
              resolve;
          },
        );
      },
    );


  const startPromise =
    session.start();


  assert.equal(
    capturedSignal.aborted,
    false,
  );


  session.stop();


  assert.equal(
    capturedSignal.aborted,
    true,
  );

  assert.equal(
    controllerRecord.stopCount,
    1,
  );


  resolveBootstrap({
    outcome:
      "aborted",

    sources: {
      health:
        "aborted",

      tasks:
        "not_attempted",

      eventTail:
        "not_attempted",
    },
  });


  const result =
    await startPromise;


  assert.equal(
    result.outcome,
    "aborted",
  );

  assert.equal(
    controllerRecord.startCount,
    0,
    "stopped bootstrap completion must not start observation",
  );


  session.stop();

  assert.equal(
    controllerRecord.stopCount,
    1,
    "application stop must remain idempotent",
  );
}


// ------------------------------------------------------------
// continue() is explicit delegation only.
// ------------------------------------------------------------

{
  const session =
    application
      .createApplicationObservationSession();

  const index =
    controllerStub
      .__records()
      .length
    - 1;

  const controllerRecord =
    controllerRecordFor(
      index,
    );


  await session.continue();


  assert.equal(
    controllerRecord.continueCount,
    1,
  );
}


// ------------------------------------------------------------
// Controller-view presentation subscriber failures are also
// contained.
// ------------------------------------------------------------

{
  const session =
    application
      .createApplicationObservationSession();

  let goodNotifications =
    0;


  session
    .controller
    .subscribe(
      () => {
        throw new Error(
          "qualification controller-view failure",
        );
      },
    );


  session
    .controller
    .subscribe(
      () => {
        goodNotifications +=
          1;
      },
    );


  runtimeStub
    .__setBootstrapImplementation(
      async () => ({
        outcome:
          "complete",

        sources: {
          health:
            "observed",

          tasks:
            "observed",

          eventTail:
            "observed",
        },
      }),
    );


  await assert.doesNotReject(
    () => session.start(),
  );


  assert.equal(
    goodNotifications,
    1,
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
      /await import\("\.\/qualify-n16\.3a2\.mjs"\);/g,
    )
    ?? []
  ).length,
  1,
  "main UI qualifier must import N16.3a2 exactly once",
);


console.log(
  "PASS: N16.3a2 application composition construction performs no bootstrap or controller start",
);

console.log(
  "PASS: N16.3a2 application boundary selects explicit immutable freshness policy and browser monotonic clock",
);

console.log(
  "PASS: N16.3a2 runtime and observation controller share one exact ObservationStore",
);

console.log(
  "PASS: N16.3a2 presentation views expose no store dispatch or controller lifecycle authority",
);

console.log(
  "PASS: N16.3a2 presentation subscriber faults cannot escape into observation state or lifecycle transitions",
);

console.log(
  "PASS: N16.3a2 event-tail baseline gates live observation independently from health/task bootstrap completeness",
);

console.log(
  "PASS: N16.3a2 failed event-tail bootstrap requires a later explicit bootstrap attempt",
);

console.log(
  "PASS: N16.3a2 concurrent bootstrap attempts are rejected",
);

console.log(
  "PASS: N16.3a2 stop aborts in-flight bootstrap and prevents post-stop transport start",
);

console.log(
  "PASS: N16.3a2 continuation remains explicit with no timer or hidden reconnect policy",
);

console.log(
  "PASS: N16.3a2 introduces no direct network, timer, React, store-mutation, or freshness-mutation authority",
);
