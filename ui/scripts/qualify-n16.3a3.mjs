// N16.3a3 REACT OBSERVATION BINDINGS QUALIFICATION

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

          jsx:
            ts.JsxEmit.ReactJSX,
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


const bindingsFilename =
  path.join(
    uiRoot,
    "src",
    "app",
    "reactObservation.ts",
  );

const mainFilename =
  path.join(
    uiRoot,
    "src",
    "main.tsx",
  );

const serviceHealthFilename =
  path.join(
    uiRoot,
    "src",
    "components",
    "status",
    "ServiceHealth.tsx",
  );

const eventsPageFilename =
  path.join(
    uiRoot,
    "src",
    "pages",
    "EventsPage.tsx",
  );


const bindingsSource =
  await readFile(
    bindingsFilename,
    "utf8",
  );

const mainSource =
  await readFile(
    mainFilename,
    "utf8",
  );

const serviceHealthSource =
  await readFile(
    serviceHealthFilename,
    "utf8",
  );

const eventsPageSource =
  await readFile(
    eventsPageFilename,
    "utf8",
  );


// ------------------------------------------------------------
// Static React-binding authority contract.
// ------------------------------------------------------------

for (const required of [
  "useSyncExternalStore",
  "applicationObservationSession",
  "observations",
  "controller",
  "freshness",
  "useEffect",
  "useState",
  "window.setInterval",
  "window.clearInterval",
  "OBSERVATION_FRESHNESS_PRESENTATION_TICK_MS",
]) {
  assert.equal(
    bindingsSource.includes(
      required,
    ),
    true,
    `React observation bindings missing ${required}`,
  );
}


for (const forbidden of [
  "fetch(",
  "EventSource(",
  "WebSocket(",
  "XMLHttpRequest",
  "readServiceHealth",
  "readTaskStatusProjections",
  "readEventTail",
  ".dispatch(",
  ".markObserved(",
  ".reset(",
  ".start(",
  ".continue(",
  ".stop(",
  "AbortController",
]) {
  assert.equal(
    bindingsSource.includes(
      forbidden,
    ),
    false,
    `React observation bindings gained forbidden authority ${forbidden}`,
  );
}


assert.equal(
  (
    bindingsSource.match(
      /\buseSyncExternalStore\s*\(/g,
    )
    ?? []
  ).length,
  2,
  "React bindings must expose exactly the observation and controller external-store subscriptions",
);


assert.equal(
  (
    bindingsSource.match(
      /\bwindow\.setInterval\s*\(/g,
    )
    ?? []
  ).length,
  1,
  "freshness presentation must own exactly one timer site",
);


assert.equal(
  (
    bindingsSource.match(
      /\bwindow\.clearInterval\s*\(/g,
    )
    ?? []
  ).length,
  1,
  "freshness presentation timer must have exact cleanup",
);


// ------------------------------------------------------------
// Dynamic binding test with deterministic React/application
// stubs.
// ------------------------------------------------------------

const reactStubSource = `
  const records = {
    externalStoreCalls: [],
    effects: [],
    stateUpdates: [],
  };

  export function useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  ) {
    records.externalStoreCalls.push({
      subscribe,
      getSnapshot,
      getServerSnapshot,
    });

    return getSnapshot();
  }

  export function useState(
    initialValue,
  ) {
    let current =
      initialValue;

    function setValue(
      update,
    ) {
      current =
        typeof update === "function"
          ? update(current)
          : update;

      records.stateUpdates.push(
        current,
      );
    }

    return [
      current,
      setValue,
    ];
  }

  export function useEffect(
    effect,
    dependencies,
  ) {
    const cleanup =
      effect();

    records.effects.push({
      dependencies,
      cleanup,
    });
  }

  export function __records() {
    return records;
  }
`;


const applicationStubSource = `
  const observationSnapshot =
    Object.freeze({
      observed:
        Object.freeze({
          health:
            Object.freeze({
              status: "ok",
            }),

          tasks: null,
          eventTail: null,
          eventWindow:
            Object.freeze([]),
        }),

      derived:
        Object.freeze({
          bootstrapEventCursor: null,
          currentEventCursor: null,
        }),
    });

  const controllerSnapshot =
    Object.freeze({
      state: "streaming",
      sessionGeneration: 1,
      retainedGapEventSeq: null,
    });

  const freshnessSnapshot =
    Object.freeze({
      health:
        Object.freeze({
          state: "fresh",
          lastObservedAtMs: 10,
          ageMs: 20,
          maxAgeMs: 30000,
        }),

      tasks:
        Object.freeze({
          state: "unobserved",
          lastObservedAtMs: null,
          ageMs: null,
          maxAgeMs: 30000,
        }),

      eventTail:
        Object.freeze({
          state: "fresh",
          lastObservedAtMs: 10,
          ageMs: 20,
          maxAgeMs: 30000,
        }),
    });

  const records = {
    observationSubscribeCalls: 0,
    controllerSubscribeCalls: 0,
    freshnessReads: 0,
  };

  function observationSubscribe() {
    records.observationSubscribeCalls += 1;
    return () => {};
  }

  function observationGetSnapshot() {
    return observationSnapshot;
  }

  function controllerSubscribe() {
    records.controllerSubscribeCalls += 1;
    return () => {};
  }

  function controllerGetSnapshot() {
    return controllerSnapshot;
  }

  function freshnessGetSnapshot() {
    records.freshnessReads += 1;
    return freshnessSnapshot;
  }

  export const applicationObservationSession =
    Object.freeze({
      observations:
        Object.freeze({
          subscribe:
            observationSubscribe,

          getSnapshot:
            observationGetSnapshot,
        }),

      controller:
        Object.freeze({
          subscribe:
            controllerSubscribe,

          getSnapshot:
            controllerGetSnapshot,
        }),

      freshness:
        Object.freeze({
          getSnapshot:
            freshnessGetSnapshot,
        }),
    });

  export function __records() {
    return records;
  }

  export function __snapshots() {
    return {
      observationSnapshot,
      controllerSnapshot,
      freshnessSnapshot,
    };
  }
`;


const reactStubUrl =
  moduleUrl(
    reactStubSource,
  );

const applicationStubUrl =
  moduleUrl(
    applicationStubSource,
  );


const preparedBindings =
  bindingsSource
    .replace(
      '"react"',
      JSON.stringify(
        reactStubUrl,
      ),
    )
    .replace(
      '"./applicationObservation"',
      JSON.stringify(
        applicationStubUrl,
      ),
    );


const bindingsUrl =
  moduleUrl(
    transpile(
      preparedBindings,
    ),
  );


const originalWindow =
  globalThis.window;

const timerRecord = {
  nextId: 1,
  active: new Map(),
  cleared: [],
};


globalThis.window =
  Object.freeze({
    setInterval(
      callback,
      milliseconds,
    ) {
      const id =
        timerRecord.nextId;

      timerRecord.nextId +=
        1;

      timerRecord.active.set(
        id,
        {
          callback,
          milliseconds,
        },
      );

      return id;
    },

    clearInterval(
      id,
    ) {
      timerRecord
        .cleared
        .push(
          id,
        );

      timerRecord
        .active
        .delete(
          id,
        );
    },
  });


try {
  const reactStub =
    await import(
      reactStubUrl,
    );

  const applicationStub =
    await import(
      applicationStubUrl,
    );

  const bindings =
    await import(
      bindingsUrl,
    );

  const snapshots =
    applicationStub
      .__snapshots();


  assert.equal(
    bindings
      .OBSERVATION_FRESHNESS_PRESENTATION_TICK_MS,
    1_000,
  );


  const observed =
    bindings
      .useObservationSnapshot();

  assert.strictEqual(
    observed,
    snapshots
      .observationSnapshot,
  );


  const controlled =
    bindings
      .useObservationControllerSnapshot();

  assert.strictEqual(
    controlled,
    snapshots
      .controllerSnapshot,
  );


  const externalStoreCalls =
    reactStub
      .__records()
      .externalStoreCalls;


  assert.equal(
    externalStoreCalls.length,
    2,
  );


  assert.strictEqual(
    externalStoreCalls[0]
      .getSnapshot,
    externalStoreCalls[0]
      .getServerSnapshot,
    "observation binding must use the same stable snapshot reader for browser/server fallback",
  );


  assert.strictEqual(
    externalStoreCalls[1]
      .getSnapshot,
    externalStoreCalls[1]
      .getServerSnapshot,
    "controller binding must use the same stable snapshot reader for browser/server fallback",
  );


  const fresh =
    bindings
      .useObservationFreshnessSnapshot();

  assert.strictEqual(
    fresh,
    snapshots
      .freshnessSnapshot,
  );


  assert.equal(
    applicationStub
      .__records()
      .freshnessReads,
    1,
  );


  const effects =
    reactStub
      .__records()
      .effects;

  assert.equal(
    effects.length,
    1,
  );


  assert.deepEqual(
    effects[0]
      .dependencies,
    [],
  );


  assert.equal(
    timerRecord
      .active
      .size,
    1,
  );


  const [
    intervalId,
    interval,
  ] =
    [...timerRecord.active.entries()][0];


  assert.equal(
    interval.milliseconds,
    1_000,
  );


  interval.callback();


  assert.deepEqual(
    reactStub
      .__records()
      .stateUpdates,
    [
      true,
    ],
    "presentation timer may only trigger React-local rerender state",
  );


  assert.equal(
    typeof effects[0].cleanup,
    "function",
  );


  effects[0].cleanup();


  assert.deepEqual(
    timerRecord.cleared,
    [
      intervalId,
    ],
  );

  assert.equal(
    timerRecord
      .active
      .size,
    0,
    "StrictMode cleanup must leave no presentation timer behind",
  );
}
finally {
  if (
    originalWindow
    === undefined
  ) {
    delete globalThis.window;
  }
  else {
    globalThis.window =
      originalWindow;
  }
}


// ------------------------------------------------------------
// ServiceHealth must consume shared read-only observation views.
// ------------------------------------------------------------

for (const required of [
  "useObservationSnapshot",
  "useObservationFreshnessSnapshot",
  "Not observed",
  "Observation stale",
  "Observed · read-only",
]) {
  assert.equal(
    serviceHealthSource.includes(
      required,
    ),
    true,
    `ServiceHealth shared-observation migration missing ${required}`,
  );
}


for (const forbidden of [
  "readServiceHealth",
  "httpClient",
  "AbortController",
  "useEffect",
  "useState",
  "fetch(",
]) {
  assert.equal(
    serviceHealthSource.includes(
      forbidden,
    ),
    false,
    `ServiceHealth retains independent observation authority ${forbidden}`,
  );
}


// ------------------------------------------------------------
// Application session startup must remain outside StrictMode.
// ------------------------------------------------------------

assert.equal(
  mainSource.includes(
    "applicationObservationSession",
  ),
  true,
);


assert.equal(
  (
    mainSource.match(
      /applicationObservationSession\s*\.\s*start\s*\(\s*\)/g,
    )
    ?? []
  ).length,
  1,
  "document composition must start application observation exactly once",
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
    `main composition gained unsupported lifecycle behavior ${forbidden}`,
  );
}


assert.equal(
  mainSource.indexOf(
    ".start()",
  )
  >
  mainSource.indexOf(
    "createRoot(root).render",
  ),
  true,
  "application startup should follow root composition and remain outside StrictMode markup",
);


assert.equal(
  mainSource.includes(
    "Application observation startup failed.",
  ),
  true,
  "startup failure must remain visible without raw diagnostic disclosure",
);


// ------------------------------------------------------------
// Static pages may not assert obsolete transport state once
// application observation startup is active.
// ------------------------------------------------------------

for (const obsolete of [
  "Stream not connected",
  "Bootstrap and SSE ingestion are",
  "intentionally deferred to",
]) {
  assert.equal(
    eventsPageSource.includes(
      obsolete,
    ),
    false,
    `EventsPage retains obsolete observation claim: ${obsolete}`,
  );
}


/*
 * N16.3a3's enduring EventsPage invariant is that obsolete
 * transport/ingestion claims remain absent. Later qualified
 * milestones may replace the temporary "Timeline pending"
 * placeholder with functional observational presentation.
 */


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
      /await import\("\.\/qualify-n16\.3a3\.mjs"\);/g,
    )
    ?? []
  ).length,
  1,
  "main UI qualifier must import N16.3a3 exactly once",
);


console.log(
  "PASS: N16.3a3 observation and controller hooks use qualified stable external-store views",
);

console.log(
  "PASS: N16.3a3 React bindings expose no network, observation mutation, controller lifecycle, or retry authority",
);

console.log(
  "PASS: N16.3a3 freshness timer owns presentation rerender cadence only",
);

console.log(
  "PASS: N16.3a3 freshness presentation timer cleans deterministically under StrictMode-style effect cleanup",
);

console.log(
  "PASS: N16.3a3 ServiceHealth consumes shared observations with no independent HTTP request",
);

console.log(
  "PASS: N16.3a3 document composition starts the application observation session exactly once outside StrictMode lifecycle",
);

console.log(
  "PASS: N16.3a3 application startup adds no hidden stop, continuation, timer, or retry policy",
);

console.log(
  "PASS: N16.3a3 EventsPage no longer asserts obsolete transport or ingestion state",
);
