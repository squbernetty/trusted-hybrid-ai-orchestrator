// N16.3a1 CONTROLLER EXTERNAL-STORE OBSERVABILITY QUALIFICATION

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const tsModule = await import("typescript");
const ts = tsModule.default ?? tsModule;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.dirname(scriptDirectory);

function transpile(source) {
  return ts.transpileModule(
    source,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
}

function moduleUrl(source) {
  return (
    "data:text/javascript;base64,"
    + Buffer.from(source, "utf8").toString("base64")
  );
}

async function waitUntil(predicate, message, turns = 100) {
  for (let turn = 0; turn < turns; turn += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  assert.fail(message);
}

const controllerFilename = path.join(
  uiRoot,
  "src",
  "state",
  "observationController.ts",
);

const controllerSource = await readFile(
  controllerFilename,
  "utf8",
);

const eventStreamStubUrl = moduleUrl([
  "export function openEventStream() {",
  "  throw new Error('unexpected default SSE');",
  "}",
].join("\n"));

const repairStubUrl = moduleUrl([
  "export async function executeGapRepairBatch() {",
  "  throw new Error('unexpected default repair');",
  "}",
].join("\n"));

const reconcilerStubUrl = moduleUrl([
  "export function reconcileEventFrame() {",
  "  throw new Error('unexpected default reconciliation');",
  "}",
  "export function reconcileValidatedEvent() {",
  "  throw new Error('unexpected default validated reconciliation');",
  "}",
].join("\n"));

const preparedController = controllerSource
  .replace(
    '"../api/eventStream"',
    JSON.stringify(eventStreamStubUrl),
  )
  .replace(
    '"./gapRepairExecutor"',
    JSON.stringify(repairStubUrl),
  )
  .replace(
    '"./eventReconciler"',
    JSON.stringify(reconcilerStubUrl),
  );

const controllerModule = await import(
  moduleUrl(transpile(preparedController))
);

function createStore(initialCursor = 42) {
  let cursor = initialCursor;
  let eventWindow = [];

  return Object.freeze({
    getSnapshot() {
      return {
        observed: {
          eventWindow,
        },
        derived: {
          currentEventCursor: cursor,
        },
      };
    },

    dispatch(action) {
      assert.equal(
        action.type,
        "observation/event-accepted",
      );
      assert.notEqual(cursor, null);
      assert.equal(
        action.event.event_seq,
        cursor + 1,
      );

      cursor = action.event.event_seq;
      eventWindow = [
        ...eventWindow,
        action.event,
      ];
    },
  });
}

function createTransport(onClose = null) {
  const sessions = [];
  let openCount = 0;
  let nextFailure = null;

  function failNextOpen(error) {
    nextFailure = error;
  }

  function open(cursor, handlers) {
    openCount += 1;

    if (nextFailure !== null) {
      const failure = nextFailure;
      nextFailure = null;
      throw failure;
    }

    const session = {
      cursor,
      handlers,
      closed: false,
      closeCount: 0,
      connection: null,
    };

    const connection = Object.freeze({
      close() {
        if (session.closed) {
          return;
        }

        session.closed = true;
        session.closeCount += 1;
        onClose?.();
      },

      isClosed() {
        return session.closed;
      },
    });

    session.connection = connection;
    sessions.push(session);
    return connection;
  }

  return {
    sessions,
    open,
    failNextOpen,
    getOpenCount() {
      return openCount;
    },
  };
}

function frame(eventSeq) {
  return Object.freeze({
    eventType: "execution.started",
    eventId: eventSeq,
    data: "{}",
  });
}

// Stable identity, subscription, disconnect, unsubscribe.
{
  const store = createStore();
  const transport = createTransport();
  const controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,
        reconcileEventFrame() {
          return {
            kind: "replay",
          };
        },
      },
    );

  const initial = controller.getSnapshot();

  assert.strictEqual(
    controller.getSnapshot(),
    initial,
  );
  assert.equal(
    Object.isFrozen(initial),
    true,
  );

  const observed = [];
  const unsubscribe = controller.subscribe(
    () => observed.push(controller.getSnapshot()),
  );

  assert.equal(observed.length, 0);

  controller.start();

  assert.deepEqual(observed, [
    {
      state: "streaming",
      sessionGeneration: 1,
      retainedGapEventSeq: null,
    },
  ]);

  assert.strictEqual(
    controller.getSnapshot(),
    observed[0],
  );

  transport.sessions[0].handlers.onFrame(
    frame(40),
  );

  assert.equal(
    observed.length,
    1,
    "snapshot-neutral replay must not notify",
  );

  transport.sessions[0].handlers.onDisconnect();

  assert.equal(observed.length, 2);
  assert.equal(observed[1].state, "disconnected");

  unsubscribe();
  unsubscribe();

  await controller.continue();

  assert.equal(
    observed.length,
    2,
    "unsubscribed listener must remain inert",
  );
  assert.equal(
    controller.getSnapshot().sessionGeneration,
    2,
  );
}

// Accepted store evidence is not a controller transition.
{
  const store = createStore();
  const transport = createTransport();
  const controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,
        reconcileEventFrame() {
          return {
            kind: "accepted",
            event: {
              event_seq: 43,
            },
          };
        },
      },
    );

  let notifications = 0;
  controller.subscribe(() => {
    notifications += 1;
  });

  controller.start();
  const streamingSnapshot = controller.getSnapshot();

  transport.sessions[0].handlers.onFrame(
    frame(43),
  );

  assert.equal(notifications, 1);
  assert.strictEqual(
    controller.getSnapshot(),
    streamingSnapshot,
  );
  assert.equal(
    store.getSnapshot().derived.currentEventCursor,
    43,
  );
}

// Gap repair transition and asynchronous failed-repair settlement.
{
  const store = createStore();
  const transport = createTransport();
  const states = [];

  const controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,

        reconcileEventFrame() {
          return {
            kind: "gap",
          };
        },

        async executeGapRepairBatch() {
          return {
            outcome: "failed",
            plan: {},
            reason: "event_page_read_failed",
          };
        },

        reconcileValidatedEvent() {
          throw new Error(
            "validated reconciliation must not run",
          );
        },
      },
    );

  controller.subscribe(() => {
    states.push(controller.getSnapshot().state);
  });

  controller.start();
  transport.sessions[0].handlers.onFrame(
    frame(45),
  );

  await waitUntil(
    () => (
      controller.getSnapshot().state
      === "disconnected"
    ),
    "failed gap repair did not settle",
  );

  assert.deepEqual(
    states,
    [
      "streaming",
      "repairing",
      "disconnected",
    ],
  );
  assert.equal(
    controller.getSnapshot().retainedGapEventSeq,
    45,
  );
}

// Re-entrant getSnapshot() during connection.close() must not consume
// the pending disconnect notification.
{
  const store = createStore();
  let controller = null;
  let closeReadCount = 0;

  const transport = createTransport(
    () => {
      closeReadCount += 1;
      controller.getSnapshot();
    },
  );

  controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,
        reconcileEventFrame() {
          return {
            kind: "replay",
          };
        },
      },
    );

  let notifications = 0;
  controller.subscribe(() => {
    notifications += 1;
  });

  controller.start();
  transport.sessions[0].handlers.onDisconnect();

  assert.equal(closeReadCount, 1);
  assert.equal(
    notifications,
    2,
    "re-entrant snapshot read must not swallow disconnect notification",
  );
  assert.equal(
    controller.getSnapshot().state,
    "disconnected",
  );
}

// A synchronous stop from a subscriber must prevent subsequent
// transport construction for the abandoned generation.
{
  const store = createStore();
  const transport = createTransport();
  let controller = null;

  controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,
        reconcileEventFrame() {
          return {
            kind: "replay",
          };
        },
      },
    );

  controller.subscribe(() => {
    if (
      controller.getSnapshot().state
      === "streaming"
    ) {
      controller.stop();
    }
  });

  controller.start();

  assert.equal(
    controller.getSnapshot().state,
    "stopped",
  );
  assert.equal(
    transport.getOpenCount(),
    0,
    "stopped generation must not construct a transport",
  );
}

// Subscriber faults are observational only.
{
  const store = createStore();
  const transport = createTransport();

  const controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,
        reconcileEventFrame() {
          return {
            kind: "replay",
          };
        },
      },
    );

  let goodNotifications = 0;

  controller.subscribe(() => {
    throw new Error(
      "qualification subscriber failure",
    );
  });

  controller.subscribe(() => {
    goodNotifications += 1;
  });

  assert.doesNotThrow(
    () => controller.start(),
  );

  assert.equal(goodNotifications, 1);
  assert.equal(
    controller.getSnapshot().state,
    "streaming",
  );
}

// Stream construction failure remains observable and consumes generation.
{
  const store = createStore();
  const transport = createTransport();
  const failure = new Error(
    "qualification open failure",
  );

  transport.failNextOpen(failure);

  const controller =
    controllerModule.createObservationController(
      store,
      {
        openEventStream: transport.open,
        reconcileEventFrame() {
          return {
            kind: "replay",
          };
        },
      },
    );

  const states = [];
  controller.subscribe(() => {
    states.push(controller.getSnapshot().state);
  });

  assert.throws(
    () => controller.start(),
    (error) => error === failure,
  );

  assert.deepEqual(
    states,
    [
      "streaming",
      "disconnected",
    ],
  );
  assert.equal(
    controller.getSnapshot().sessionGeneration,
    1,
  );
}

// Structural authority boundaries.
for (const required of [
  "ObservationControllerListener",
  "subscribe",
  "publishSnapshotIfChanged",
  "Object.freeze",
]) {
  assert.equal(
    controllerSource.includes(required),
    true,
    `controller missing ${required}`,
  );
}

for (const forbidden of [
  "refreshSnapshot",
  "setTimeout(",
  "setInterval(",
  "Date.now(",
  "performance.now(",
  "useEffect(",
  "useState(",
  "useSyncExternalStore(",
  'from "react"',
]) {
  assert.equal(
    controllerSource.includes(forbidden),
    false,
    `controller gained forbidden responsibility ${forbidden}`,
  );
}

assert.equal(
  (
    controllerSource.match(
      /\.openEventStream\s*\(/g,
    )
    ?? []
  ).length,
  1,
);

assert.equal(
  (
    controllerSource.match(
      /\.dispatch\s*\(/g,
    )
    ?? []
  ).length,
  1,
);

console.log(
  "PASS: N16.3a1 stable controller snapshot identity qualified",
);
console.log(
  "PASS: N16.3a1 controller subscription lifecycle qualified",
);
console.log(
  "PASS: N16.3a1 snapshot-neutral evidence does not notify controller subscribers",
);
console.log(
  "PASS: N16.3a1 gap repair transitions remain observable",
);
console.log(
  "PASS: N16.3a1 re-entrant snapshot reads cannot consume notifications",
);
console.log(
  "PASS: N16.3a1 subscriber re-entrancy cannot create transport after stop",
);
console.log(
  "PASS: N16.3a1 subscriber faults cannot alter controller lifecycle",
);
console.log(
  "PASS: N16.3a1 introduces no timer, clock, React, or additional authority",
);
