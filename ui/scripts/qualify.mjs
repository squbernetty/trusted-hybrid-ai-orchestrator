import assert from "node:assert/strict";
import {
  createServer as createHttpServer,
} from "node:http";
import {
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  createServer as createViteServer,
} from "vite";


const scriptPath = fileURLToPath(import.meta.url);
const uiRoot = path.resolve(
  path.dirname(scriptPath),
  "..",
);


async function readJson(relativePath) {
  const content = await readFile(
    path.join(uiRoot, relativePath),
    "utf8",
  );

  return JSON.parse(content);
}


async function walk(directory) {
  const entries = await readdir(
    directory,
    {
      withFileTypes: true,
    },
  );

  const result = [];

  for (const entry of entries) {
    const absolute = path.join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      result.push(
        ...(await walk(absolute)),
      );

      continue;
    }

    if (entry.isFile()) {
      result.push(absolute);
    }
  }

  return result;
}


function listen(server, port) {
  return new Promise(
    (resolve, reject) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        port,
        "127.0.0.1",
        () => {
          server.removeListener(
            "error",
            reject,
          );

          resolve();
        },
      );
    },
  );
}


function closeHttpServer(server) {
  return new Promise(
    (resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    },
  );
}


// ==========================================================
// Exact dependency contract
// ==========================================================

const packageJson = await readJson(
  "package.json",
);

assert.equal(
  packageJson.packageManager,
  "npm@11.19.0",
);

assert.deepEqual(
  packageJson.dependencies,
  {
    react: "19.2.8",
    "react-dom": "19.2.8",
  },
);

assert.deepEqual(
  packageJson.devDependencies,
  {
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    typescript: "6.0.3",
    vite: "8.2.2",
  },
);

console.log(
  "PASS: exact frontend dependency contract preserved",
);


// ==========================================================
// Lockfile root contract
// ==========================================================

const lock = await readJson(
  "package-lock.json",
);

assert.equal(
  lock.lockfileVersion,
  3,
);

const lockRoot = lock.packages[""];

assert.deepEqual(
  lockRoot.dependencies,
  packageJson.dependencies,
);

assert.deepEqual(
  lockRoot.devDependencies,
  packageJson.devDependencies,
);

console.log(
  "PASS: package lock matches exact root dependency contract",
);


// ==========================================================
// Source trust-boundary contract
// ==========================================================

const sourceRoot = path.join(
  uiRoot,
  "src",
);

const sourceFiles = await walk(
  sourceRoot,
);

const requiredShellFiles = [
  "src/api/httpClient.ts",
  "src/api/schemas.ts",
  "src/app/App.tsx",
  "src/app/routes.tsx",
  "src/components/shell/AppShell.tsx",
  "src/components/shell/SidebarNav.tsx",
  "src/components/status/ServiceHealth.tsx",
  "src/pages/OverviewPage.tsx",
  "src/pages/TaskPage.tsx",
  "src/pages/EventsPage.tsx",
];

for (const relativePath of requiredShellFiles) {
  await readFile(
    path.join(
      uiRoot,
      relativePath,
    ),
    "utf8",
  );
}

console.log(
  "PASS: N16.1 shell module boundaries are present",
);


const forbiddenSourceTokens = [
  "WebSocket(",
  "XMLHttpRequest",
  "axios",
  "http://",
  "https://",
];

let fetchCount = 0;

for (const filename of sourceFiles) {
  const content = await readFile(
    filename,
    "utf8",
  );

  fetchCount += (
    content.match(/fetch\(/g)
    ?? []
  ).length;

  for (
    const token
    of forbiddenSourceTokens
  ) {
    assert.equal(
      content.includes(token),
      false,
      `${
        path.relative(uiRoot, filename)
      } contains forbidden N16.1b token ${token}`,
    );
  }

  for (const mutationVerb of [
    'method: "POST"',
    'method: "PUT"',
    'method: "PATCH"',
    'method: "DELETE"',
  ]) {
    assert.equal(
      content.includes(mutationVerb),
      false,
      `${
        path.relative(uiRoot, filename)
      } contains forbidden mutation ${mutationVerb}`,
    );
  }
}

assert.equal(
  fetchCount,
  1,
  "N16.2a must retain one centralized browser fetch primitive",
);

const healthClient = await readFile(
  path.join(
    uiRoot,
    "src",
    "api",
    "httpClient.ts",
  ),
  "utf8",
);

for (const endpoint of [
  '"/api/v1/health"',
  '"/api/v1/tasks?limit=100"',
  '"/api/v1/events/tail?limit=100"',
]) {
  assert.equal(
    healthClient.includes(endpoint),
    true,
    `missing bounded observer endpoint ${endpoint}`,
  );
}

assert.equal(
  healthClient.includes(
    "type ReadOnlyEndpoint",
  ),
  true,
);

assert.equal(
  /fetch\(\s*endpoint\s*,/.test(
    healthClient,
  ),
  true,
  "centralized fetch must receive the bounded endpoint parameter",
);

assert.equal(
  healthClient.includes(
    'method: "GET"',
  ),
  true,
);

assert.equal(
  healthClient.includes(
    'credentials: "same-origin"',
  ),
  true,
);

const healthSchema = await readFile(
  path.join(
    uiRoot,
    "src",
    "api",
    "schemas.ts",
  ),
  "utf8",
);

for (const contractToken of [
  '"ok"',
  '"trusted-hybrid-ai-orchestrator-control-plane"',
  '"1.0"',
  '"read_only"',
]) {
  assert.equal(
    healthSchema.includes(contractToken),
    true,
    `missing health contract ${contractToken}`,
  );
}

console.log(
  "PASS: browser observation is limited to three validated bounded GET surfaces",
);


// ==========================================================
// HTML / production build remote-resource contract
// ==========================================================

const indexHtml = await readFile(
  path.join(
    uiRoot,
    "index.html",
  ),
  "utf8",
);

assert.equal(
  /https?:\/\//i.test(indexHtml),
  false,
);

const distHtml = await readFile(
  path.join(
    uiRoot,
    "dist",
    "index.html",
  ),
  "utf8",
);

assert.equal(
  /https?:\/\//i.test(distHtml),
  false,
);

console.log(
  "PASS: HTML contains no remote runtime resources",
);


// ==========================================================
// Behavioral Vite security + proxy qualification
// ==========================================================

const backend = createHttpServer(
  (request, response) => {
    if (
      request.method === "GET"
      && request.url === "/api/v1/health"
    ) {
      response.writeHead(
        200,
        {
          "Content-Type": "application/json",
        },
      );

      response.end(
        JSON.stringify({
          status: "ok",
          service:
            "trusted-hybrid-ai-orchestrator-control-plane",
          api_version: "1.0",
          authority: "read_only",
        }),
      );

      return;
    }

    response.writeHead(404);
    response.end();
  },
);

let vite;

try {
  await listen(
    backend,
    8765,
  );

  vite = await createViteServer({
    root: uiRoot,
    logLevel: "silent",
  });

  await vite.listen();

  const address =
    vite.httpServer?.address();

  assert.notEqual(
    address,
    null,
  );

  assert.equal(
    typeof address,
    "object",
  );

  assert.equal(
    address.address,
    "127.0.0.1",
  );

  assert.equal(
    address.port,
    5173,
  );

  console.log(
    "PASS: Vite development server binds to loopback only",
  );

  assert.equal(
    vite.config.server.hmr,
    false,
  );

  console.log(
    "PASS: development HMR is disabled under strict CSP",
  );


  const rootResponse = await fetch(
    "http://127.0.0.1:5173/",
  );

  assert.equal(
    rootResponse.status,
    200,
  );

  assert.equal(
    rootResponse.headers.get(
      "x-content-type-options",
    ),
    "nosniff",
  );

  assert.equal(
    rootResponse.headers.get(
      "x-frame-options",
    ),
    "DENY",
  );

  assert.equal(
    rootResponse.headers.get(
      "referrer-policy",
    ),
    "no-referrer",
  );

  assert.equal(
    rootResponse.headers.get(
      "cross-origin-opener-policy",
    ),
    "same-origin",
  );

  const csp =
    rootResponse.headers.get(
      "content-security-policy",
    );

  assert.notEqual(
    csp,
    null,
  );

  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.equal(
      csp.includes(directive),
      true,
      `missing CSP directive ${directive}`,
    );
  }

  console.log(
    "PASS: development security headers are active",
  );


  const healthResponse = await fetch(
    "http://127.0.0.1:5173/api/v1/health",
  );

  assert.equal(
    healthResponse.status,
    200,
  );

  const health =
    await healthResponse.json();

  assert.deepEqual(
    health,
    {
      status: "ok",
      service:
        "trusted-hybrid-ai-orchestrator-control-plane",
      api_version: "1.0",
      authority: "read_only",
    },
  );

  console.log(
    "PASS: same-origin /api proxy reaches loopback control plane",
  );
}
finally {
  if (vite !== undefined) {
    await vite.close();
  }

  await closeHttpServer(
    backend,
  );
}

console.log(
  "PASS: qualification servers closed cleanly",
);

console.log("");
console.log(
  "N16.1a FRONTEND SCAFFOLD QUALIFICATION PASSED.",
);


// ============================================================
// N16.2a CONTRACT PARSER QUALIFICATION
// ============================================================

{
  const {
    readFile: readN162File,
  } = await import(
    "node:fs/promises"
  );

  const n162Path =
    await import("node:path");

  const {
    fileURLToPath:
      n162FileURLToPath,
  } = await import("node:url");

  const n162Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162TsModule =
    await import("typescript");

  const n162Ts =
    n162TsModule.default
    ?? n162TsModule;

  const n162ScriptDirectory =
    n162Path.dirname(
      n162FileURLToPath(
        import.meta.url,
      ),
    );

  const n162Root =
    n162Path.dirname(
      n162ScriptDirectory,
    );

  const n162SchemaFilename =
    n162Path.join(
      n162Root,
      "src",
      "api",
      "schemas.ts",
    );

  const n162SchemaSource =
    await readN162File(
      n162SchemaFilename,
      "utf8",
    );

  const n162Transpiled =
    n162Ts.transpileModule(
      n162SchemaSource,
      {
        compilerOptions: {
          target:
            n162Ts.ScriptTarget.ES2022,
          module:
            n162Ts.ModuleKind.ES2022,
        },
      },
    ).outputText;

  const n162Module =
    await import(
      `data:text/javascript;base64,${
        Buffer.from(
          n162Transpiled,
          "utf8",
        ).toString("base64")
      }`
    );

  const validTask = {
    schema_version: "1.0",
    task_id: "task-001",
    active_project: "project-a",
    task_class: "ENGINEERING",
    risk_level: "medium",
    reasoning_mode: "high",
    status: "ADJUDICATE",
    next_action:
      "supervisor_adjudicate",
    worker_calls_used: 2,
    worker_calls_max: 5,
    parallel_workers_active: 0,
    local_runtime_seconds_used:
      12.5,
    cloud_worker_calls_used: 0,
    checkpoint_last:
      "worker_completed",
    checkpoint_resume_from:
      "ADJUDICATE",
    human_gate_status:
      "pending",
    human_gate_approval:
      "A2_COMMIT",
  };

  const parsedTasks =
    n162Module
      .parseTaskStatusProjectionCollection(
        {
          tasks: [
            validTask,
          ],
          limit: 100,
          truncated: false,
        },
      );

  n162Assert.equal(
    parsedTasks.tasks.length,
    1,
  );

  n162Assert.equal(
    parsedTasks.tasks[0].task_id,
    "task-001",
  );

  n162Assert.throws(
    () => (
      n162Module
        .parseTaskStatusProjection(
          {
            ...validTask,
            worker_calls_used:
              true,
          },
        )
    ),
  );

  n162Assert.throws(
    () => (
      n162Module
        .parseTaskStatusProjectionCollection(
          {
            tasks: [
              validTask,
              validTask,
            ],
            limit: 1,
            truncated: true,
          },
        )
    ),
  );

  const validEvent = {
    schema_version: "1.0",
    event_seq: 12,
    event_id:
      "evt-qualification",
    event_type:
      "execution.started",
    occurred_at:
      "2026-09-18T12:00:00+00:00",
    source_class:
      "execution_supervisor",
    component:
      "worker_execution_supervisor",
    task_id: "task-001",
    execution_id: "x0001",
    parent_execution_id: null,
    request_id: null,
    worker_role: null,
    provider_id:
      "lm-studio",
    model_id:
      "qwen/qwen3.5-9b",
    state_before: null,
    state_after: null,
    reason_code: null,
    evidence_refs: [],
    payload: {
      attempt_id: "a0001",
      details: {
        timeout_seconds: 60,
      },
    },
  };

  const parsedEvent =
    n162Module
      .parseOrchestratorEvent(
        validEvent,
      );

  n162Assert.equal(
    parsedEvent.event_seq,
    12,
  );

  n162Assert.notEqual(
    parsedEvent.payload,
    validEvent.payload,
  );

  n162Assert.throws(
    () => (
      n162Module
        .parseOrchestratorEvent(
          {
            ...validEvent,
            occurred_at:
              "2026-09-18T12:00:00",
          },
        )
    ),
  );

  n162Assert.throws(
    () => (
      n162Module
        .parseOrchestratorEvent(
          {
            ...validEvent,
            evidence_refs: [
              "ev-1",
              "ev-1",
            ],
          },
        )
    ),
  );

  const parsedTail =
    n162Module
      .parseEventTailResponse(
        {
          events: [
            validEvent,
            {
              ...validEvent,
              event_seq: 13,
              event_id:
                "evt-qualification-2",
            },
          ],
          count: 2,
          limit: 100,
        },
      );

  n162Assert.equal(
    parsedTail.events.length,
    2,
  );

  n162Assert.throws(
    () => (
      n162Module
        .parseEventTailResponse(
          {
            events: [
              validEvent,
            ],
            count: 2,
            limit: 100,
          },
        )
    ),
  );

  n162Assert.throws(
    () => (
      n162Module
        .parseEventTailResponse(
          {
            events: [
              {
                ...validEvent,
                event_seq: 13,
                event_id: "later",
              },
              {
                ...validEvent,
                event_seq: 12,
                event_id: "earlier",
              },
            ],
            count: 2,
            limit: 100,
          },
        )
    ),
  );

  console.log(
    "PASS: N16.2a task projection parser accepts exact bounded contract",
  );

  console.log(
    "PASS: N16.2a malformed task projections fail closed",
  );

  console.log(
    "PASS: N16.2a trusted event parser validates JSON-safe event shape",
  );

  console.log(
    "PASS: N16.2a malformed event timestamps/evidence fail closed",
  );

  console.log(
    "PASS: N16.2a event-tail count/order contract enforced",
  );
}


// ============================================================
// N16.2b OBSERVATION STORE QUALIFICATION
// ============================================================

{
  const {
    readFile: readN162bFile,
  } = await import(
    "node:fs/promises"
  );

  const n162bPath =
    await import("node:path");

  const {
    fileURLToPath:
      n162bFileURLToPath,
  } = await import(
    "node:url"
  );

  const n162bAssert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162bTsModule =
    await import(
      "typescript"
    );

  const n162bTs =
    n162bTsModule.default
    ?? n162bTsModule;

  const n162bScriptDirectory =
    n162bPath.dirname(
      n162bFileURLToPath(
        import.meta.url,
      ),
    );

  const n162bRoot =
    n162bPath.dirname(
      n162bScriptDirectory,
    );

  const n162bStoreFilename =
    n162bPath.join(
      n162bRoot,
      "src",
      "state",
      "observationStore.ts",
    );

  const n162bSource =
    await readN162bFile(
      n162bStoreFilename,
      "utf8",
    );

  const n162bTranspiled =
    n162bTs.transpileModule(
      n162bSource,
      {
        compilerOptions: {
          target:
            n162bTs
              .ScriptTarget
              .ES2022,

          module:
            n162bTs
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const n162bModule =
    await import(
      `data:text/javascript;base64,${
        Buffer.from(
          n162bTranspiled,
          "utf8",
        ).toString(
          "base64",
        )
      }`
    );


  // ----------------------------------------------------------
  // Initial state
  // ----------------------------------------------------------

  const initial =
    n162bModule
      .createInitialObservationState();

  n162bAssert.equal(
    initial.observed.health,
    null,
  );

  n162bAssert.equal(
    initial.observed.tasks,
    null,
  );

  n162bAssert.equal(
    initial.observed.eventTail,
    null,
  );

  n162bAssert.equal(
    initial.derived.bootstrapEventCursor,
    null,
  );

  n162bAssert.equal(
    Object.isFrozen(initial),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      initial.observed,
    ),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      initial.derived,
    ),
    true,
  );


  // ----------------------------------------------------------
  // Representative validated observations
  // ----------------------------------------------------------

  const health = {
    status: "ok",
    service:
      "trusted-hybrid-ai-orchestrator-control-plane",
    api_version: "1.0",
    authority: "read_only",
  };

  const tasks = {
    tasks: [
      {
        schema_version: "1.0",
        task_id: "task-001",
        active_project:
          "project-a",
        task_class:
          "ENGINEERING",
        risk_level: "medium",
        reasoning_mode: "high",
        status: "ADJUDICATE",
        next_action:
          "supervisor_adjudicate",
        worker_calls_used: 2,
        worker_calls_max: 5,
        parallel_workers_active: 0,
        local_runtime_seconds_used:
          12.5,
        cloud_worker_calls_used: 0,
        checkpoint_last:
          "worker_completed",
        checkpoint_resume_from:
          "ADJUDICATE",
        human_gate_status:
          "pending",
        human_gate_approval:
          "A2_COMMIT",
      },
    ],
    limit: 100,
    truncated: false,
  };

  const firstEvent = {
    schema_version: "1.0",
    event_seq: 41,
    event_id: "evt-41",
    event_type:
      "execution.started",
    occurred_at:
      "2026-09-18T12:00:00+00:00",
    source_class:
      "execution_supervisor",
    component:
      "worker_execution_supervisor",
    task_id: "task-001",
    execution_id: "x0001",
    parent_execution_id:
      null,
    request_id: null,
    worker_role: null,
    provider_id:
      "lm-studio",
    model_id:
      "qwen/qwen3.5-9b",
    state_before: null,
    state_after: null,
    reason_code: null,
    evidence_refs: [],
    payload: {
      attempt_id: "a0001",
      nested: {
        value: 1,
      },
    },
  };

  const secondEvent = {
    ...firstEvent,
    event_seq: 42,
    event_id: "evt-42",
    event_type:
      "execution.completed",
  };

  const eventTail = {
    events: [
      firstEvent,
      secondEvent,
    ],
    count: 2,
    limit: 100,
  };


  // ----------------------------------------------------------
  // Pure reducer preserves unrelated observations
  // ----------------------------------------------------------

  const withHealth =
    n162bModule
      .reduceObservationState(
        initial,
        {
          type:
            "observation/health",
          observation: health,
        },
      );

  n162bAssert.notEqual(
    withHealth,
    initial,
  );

  n162bAssert.equal(
    initial.observed.health,
    null,
  );

  n162bAssert.equal(
    withHealth
      .observed
      .health
      .status,
    "ok",
  );


  const withTasks =
    n162bModule
      .reduceObservationState(
        withHealth,
        {
          type:
            "observation/tasks",
          observation: tasks,
        },
      );

  n162bAssert.equal(
    withTasks
      .observed
      .health
      .status,
    "ok",
  );

  n162bAssert.equal(
    withTasks
      .observed
      .tasks
      .tasks[0]
      .task_id,
    "task-001",
  );


  const withTail =
    n162bModule
      .reduceObservationState(
        withTasks,
        {
          type:
            "observation/event-tail",
          observation:
            eventTail,
        },
      );

  n162bAssert.equal(
    withTail
      .observed
      .health
      .status,
    "ok",
  );

  n162bAssert.equal(
    withTail
      .observed
      .tasks
      .tasks[0]
      .task_id,
    "task-001",
  );

  n162bAssert.equal(
    withTail
      .observed
      .eventTail
      .count,
    2,
  );

  n162bAssert.equal(
    withTail
      .derived
      .bootstrapEventCursor,
    42,
  );


  // ----------------------------------------------------------
  // Derived metadata remains distinct from observed payload
  // ----------------------------------------------------------

  n162bAssert.equal(
    Object.hasOwn(
      withTail.observed,
      "bootstrapEventCursor",
    ),
    false,
  );

  n162bAssert.equal(
    Object.hasOwn(
      withTail.derived,
      "bootstrapEventCursor",
    ),
    true,
  );


  // ----------------------------------------------------------
  // Store owns immutable copies
  // ----------------------------------------------------------

  const store =
    n162bModule
      .createObservationStore();

  let notificationCount = 0;

  const unsubscribe =
    store.subscribe(
      () => {
        notificationCount += 1;
      },
    );

  store.dispatch({
    type:
      "observation/tasks",
    observation: tasks,
  });

  const storedTasks =
    store
      .getSnapshot()
      .observed
      .tasks;

  n162bAssert.notEqual(
    storedTasks,
    tasks,
  );

  n162bAssert.equal(
    Object.isFrozen(
      storedTasks,
    ),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      storedTasks.tasks,
    ),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      storedTasks.tasks[0],
    ),
    true,
  );

  tasks.tasks[0].status =
    "MUTATED-OUTSIDE-STORE";

  n162bAssert.equal(
    store
      .getSnapshot()
      .observed
      .tasks
      .tasks[0]
      .status,
    "ADJUDICATE",
  );


  store.dispatch({
    type:
      "observation/event-tail",
    observation:
      eventTail,
  });

  const storedTail =
    store
      .getSnapshot()
      .observed
      .eventTail;

  n162bAssert.equal(
    Object.isFrozen(
      storedTail,
    ),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      storedTail.events,
    ),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      storedTail
        .events[0]
        .payload,
    ),
    true,
  );

  n162bAssert.equal(
    Object.isFrozen(
      storedTail
        .events[0]
        .payload
        .nested,
    ),
    true,
  );

  eventTail
    .events[0]
    .payload
    .nested
    .value = 999;

  n162bAssert.equal(
    store
      .getSnapshot()
      .observed
      .eventTail
      .events[0]
      .payload
      .nested
      .value,
    1,
  );

  n162bAssert.equal(
    store
      .getSnapshot()
      .derived
      .bootstrapEventCursor,
    42,
  );


  // ----------------------------------------------------------
  // Empty tail produces no cursor
  // ----------------------------------------------------------

  store.dispatch({
    type:
      "observation/event-tail",
    observation: {
      events: [],
      count: 0,
      limit: 100,
    },
  });

  n162bAssert.equal(
    store
      .getSnapshot()
      .derived
      .bootstrapEventCursor,
    null,
  );


  // ----------------------------------------------------------
  // Subscriber lifecycle
  // ----------------------------------------------------------

  n162bAssert.equal(
    notificationCount,
    3,
  );

  unsubscribe();

  store.dispatch({
    type:
      "observation/health",
    observation: health,
  });

  n162bAssert.equal(
    notificationCount,
    3,
  );


  // ----------------------------------------------------------
  // Reset
  // ----------------------------------------------------------

  store.dispatch({
    type:
      "observation/reset",
  });

  const reset =
    store.getSnapshot();

  n162bAssert.equal(
    reset.observed.health,
    null,
  );

  n162bAssert.equal(
    reset.observed.tasks,
    null,
  );

  n162bAssert.equal(
    reset.observed.eventTail,
    null,
  );

  n162bAssert.equal(
    reset.derived.bootstrapEventCursor,
    null,
  );


  console.log(
    "PASS: N16.2b initial observation state is empty and immutable",
  );

  console.log(
    "PASS: N16.2b reducer preserves unrelated validated observations",
  );

  console.log(
    "PASS: N16.2b event bootstrap cursor is explicitly derived",
  );

  console.log(
    "PASS: N16.2b stored observations are deeply cloned and frozen",
  );

  console.log(
    "PASS: N16.2b external input mutation cannot alter stored observations",
  );

  console.log(
    "PASS: N16.2b subscription lifecycle is deterministic",
  );

  console.log(
    "PASS: N16.2b reset returns empty observation state",
  );
}


// ============================================================
// N16.2c DETERMINISTIC BOOTSTRAP COORDINATOR QUALIFICATION
// ============================================================

{
  const {
    readFile: readN162cFile,
  } = await import(
    "node:fs/promises"
  );

  const n162cPath =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162cFileURLToPath,
  } = await import(
    "node:url"
  );

  const n162cAssert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162cTsModule =
    await import(
      "typescript"
    );

  const n162cTs =
    n162cTsModule.default
    ?? n162cTsModule;

  const n162cScriptDirectory =
    n162cPath.dirname(
      n162cFileURLToPath(
        import.meta.url,
      ),
    );

  const n162cRoot =
    n162cPath.dirname(
      n162cScriptDirectory,
    );

  const n162cFilename =
    n162cPath.join(
      n162cRoot,
      "src",
      "state",
      "bootstrapCoordinator.ts",
    );

  const n162cSource =
    await readN162cFile(
      n162cFilename,
      "utf8",
    );

  const n162cTranspiled =
    n162cTs.transpileModule(
      n162cSource,
      {
        compilerOptions: {
          target:
            n162cTs
              .ScriptTarget
              .ES2022,

          module:
            n162cTs
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const n162cModule =
    await import(
      `data:text/javascript;base64,${
        Buffer.from(
          n162cTranspiled,
          "utf8",
        ).toString(
          "base64",
        )
      }`
    );


  // ----------------------------------------------------------
  // Representative validated observations.
  // The coordinator does not re-validate them; N16.2a owns
  // that boundary.
  // ----------------------------------------------------------

  const healthObservation = {
    status: "ok",
    service:
      "trusted-hybrid-ai-orchestrator-control-plane",
    api_version: "1.0",
    authority: "read_only",
  };

  const taskObservation = {
    tasks: [],
    limit: 100,
    truncated: false,
  };

  const eventObservation = {
    events: [],
    count: 0,
    limit: 100,
  };


  function createRecordingStore() {
    const actions = [];

    return {
      actions,

      store: {
        getSnapshot() {
          throw new Error(
            "getSnapshot not required by coordinator qualification",
          );
        },

        dispatch(action) {
          actions.push(
            action,
          );
        },

        subscribe() {
          throw new Error(
            "subscribe not required by coordinator qualification",
          );
        },
      },
    };
  }


  // ----------------------------------------------------------
  // Complete bootstrap:
  // fixed read order and fixed dispatch order.
  // ----------------------------------------------------------

  {
    const {
      actions,
      store,
    } = createRecordingStore();

    const calls = [];

    const result =
      await n162cModule
        .bootstrapObservations(
          store,
          {
            async readHealth() {
              calls.push(
                "health",
              );

              return healthObservation;
            },

            async readTasks() {
              calls.push(
                "tasks",
              );

              return taskObservation;
            },

            async readEventTail() {
              calls.push(
                "eventTail",
              );

              return eventObservation;
            },
          },
        );

    n162cAssert.deepEqual(
      calls,
      [
        "health",
        "tasks",
        "eventTail",
      ],
    );

    n162cAssert.deepEqual(
      actions.map(
        (action) => (
          action.type
        ),
      ),
      [
        "observation/health",
        "observation/tasks",
        "observation/event-tail",
      ],
    );

    n162cAssert.equal(
      result.outcome,
      "complete",
    );

    n162cAssert.deepEqual(
      result.sources,
      {
        health: "observed",
        tasks: "observed",
        eventTail: "observed",
      },
    );

    n162cAssert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    n162cAssert.equal(
      Object.isFrozen(
        result.sources,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Partial failure:
  // one failed source does not erase or block independent
  // valid observations.
  // ----------------------------------------------------------

  {
    const {
      actions,
      store,
    } = createRecordingStore();

    const calls = [];

    const result =
      await n162cModule
        .bootstrapObservations(
          store,
          {
            async readHealth() {
              calls.push(
                "health",
              );

              return healthObservation;
            },

            async readTasks() {
              calls.push(
                "tasks",
              );

              throw new Error(
                "qualification task failure",
              );
            },

            async readEventTail() {
              calls.push(
                "eventTail",
              );

              return eventObservation;
            },
          },
        );

    n162cAssert.deepEqual(
      calls,
      [
        "health",
        "tasks",
        "eventTail",
      ],
    );

    n162cAssert.deepEqual(
      actions.map(
        (action) => (
          action.type
        ),
      ),
      [
        "observation/health",
        "observation/event-tail",
      ],
    );

    n162cAssert.equal(
      result.outcome,
      "partial",
    );

    n162cAssert.deepEqual(
      result.sources,
      {
        health: "observed",
        tasks: "failed",
        eventTail: "observed",
      },
    );
  }


  // ----------------------------------------------------------
  // Complete read failure.
  // ----------------------------------------------------------

  {
    const {
      actions,
      store,
    } = createRecordingStore();

    const result =
      await n162cModule
        .bootstrapObservations(
          store,
          {
            async readHealth() {
              throw new Error(
                "health failure",
              );
            },

            async readTasks() {
              throw new Error(
                "task failure",
              );
            },

            async readEventTail() {
              throw new Error(
                "event failure",
              );
            },
          },
        );

    n162cAssert.equal(
      actions.length,
      0,
    );

    n162cAssert.equal(
      result.outcome,
      "failed",
    );

    n162cAssert.deepEqual(
      result.sources,
      {
        health: "failed",
        tasks: "failed",
        eventTail: "failed",
      },
    );
  }


  // ----------------------------------------------------------
  // Pre-aborted bootstrap performs no reads.
  // ----------------------------------------------------------

  {
    const {
      actions,
      store,
    } = createRecordingStore();

    const calls = [];

    const controller =
      new AbortController();

    controller.abort();

    const result =
      await n162cModule
        .bootstrapObservations(
          store,
          {
            async readHealth() {
              calls.push(
                "health",
              );

              return healthObservation;
            },

            async readTasks() {
              calls.push(
                "tasks",
              );

              return taskObservation;
            },

            async readEventTail() {
              calls.push(
                "eventTail",
              );

              return eventObservation;
            },
          },
          controller.signal,
        );

    n162cAssert.equal(
      actions.length,
      0,
    );

    n162cAssert.deepEqual(
      calls,
      [],
    );

    n162cAssert.equal(
      result.outcome,
      "aborted",
    );

    n162cAssert.deepEqual(
      result.sources,
      {
        health: "aborted",
        tasks: "not_attempted",
        eventTail: "not_attempted",
      },
    );
  }


  // ----------------------------------------------------------
  // Abort after a reader resolves but before its result can
  // be accepted must prevent dispatch.
  // ----------------------------------------------------------

  {
    const {
      actions,
      store,
    } = createRecordingStore();

    const calls = [];

    const controller =
      new AbortController();

    const result =
      await n162cModule
        .bootstrapObservations(
          store,
          {
            async readHealth() {
              calls.push(
                "health",
              );

              controller.abort();

              return healthObservation;
            },

            async readTasks() {
              calls.push(
                "tasks",
              );

              return taskObservation;
            },

            async readEventTail() {
              calls.push(
                "eventTail",
              );

              return eventObservation;
            },
          },
          controller.signal,
        );

    n162cAssert.equal(
      actions.length,
      0,
    );

    n162cAssert.deepEqual(
      calls,
      [
        "health",
      ],
    );

    n162cAssert.equal(
      result.outcome,
      "aborted",
    );

    n162cAssert.deepEqual(
      result.sources,
      {
        health: "aborted",
        tasks: "not_attempted",
        eventTail: "not_attempted",
      },
    );
  }


  // ----------------------------------------------------------
  // Dispatch/programming faults are not disguised as network
  // or observation failures.
  // ----------------------------------------------------------

  {
    await n162cAssert.rejects(
      () => (
        n162cModule
          .bootstrapObservations(
            {
              getSnapshot() {
                throw new Error(
                  "unused",
                );
              },

              dispatch() {
                throw new Error(
                  "dispatch failure",
                );
              },

              subscribe() {
                throw new Error(
                  "unused",
                );
              },
            },
            {
              async readHealth() {
                return healthObservation;
              },

              async readTasks() {
                return taskObservation;
              },

              async readEventTail() {
                return eventObservation;
              },
            },
          )
      ),
      /dispatch failure/,
    );
  }


  console.log(
    "PASS: N16.2c bootstrap executes readers in deterministic order",
  );

  console.log(
    "PASS: N16.2c successful observations dispatch in deterministic order",
  );

  console.log(
    "PASS: N16.2c partial failure preserves independent valid observations",
  );

  console.log(
    "PASS: N16.2c complete read failure produces no observations",
  );

  console.log(
    "PASS: N16.2c cancellation prevents post-abort observation dispatch",
  );

  console.log(
    "PASS: N16.2c bootstrap outcome metadata is immutable and local",
  );

  console.log(
    "PASS: N16.2c programming/store faults propagate rather than masquerade as read failure",
  );
}


// ============================================================
// N16.2d OBSERVATION RUNTIME COMPOSITION QUALIFICATION
// ============================================================

{
  const {
    readFile: readN162dFile,
  } = await import(
    "node:fs/promises"
  );

  const n162dPath =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162dFileURLToPath,
  } = await import(
    "node:url"
  );

  const n162dAssert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162dScriptDirectory =
    n162dPath.dirname(
      n162dFileURLToPath(
        import.meta.url,
      ),
    );

  const n162dRoot =
    n162dPath.dirname(
      n162dScriptDirectory,
    );

  const n162dFilename =
    n162dPath.join(
      n162dRoot,
      "src",
      "state",
      "observationRuntime.ts",
    );

  const n162dSource =
    await readN162dFile(
      n162dFilename,
      "utf8",
    );


  // ----------------------------------------------------------
  // Exact composition dependencies.
  // ----------------------------------------------------------

  for (const token of [
    "readServiceHealth",
    "readTaskStatusProjections",
    "readEventTail",
    "bootstrapObservations",
    "createObservationStore",
    "BootstrapReaders",
    "BootstrapResult",
    "ObservationStore",
  ]) {
    n162dAssert.equal(
      n162dSource.includes(
        token,
      ),
      true,
      `missing runtime composition dependency ${token}`,
    );
  }


  // ----------------------------------------------------------
  // Exact concrete reader bindings.
  // ----------------------------------------------------------

  n162dAssert.match(
    n162dSource,
    /readHealth\s*:\s*readServiceHealth/,
  );

  n162dAssert.match(
    n162dSource,
    /readTasks\s*:\s*readTaskStatusProjections/,
  );

  n162dAssert.match(
    n162dSource,
    /readEventTail\s*,/,
  );


  // ----------------------------------------------------------
  // Runtime exposes store + explicit bootstrap only.
  // ----------------------------------------------------------

  n162dAssert.match(
    n162dSource,
    /export interface ObservationRuntime/,
  );

  n162dAssert.match(
    n162dSource,
    /readonly store\s*:\s*ObservationStore/,
  );

  n162dAssert.match(
    n162dSource,
    /readonly bootstrap\s*:/,
  );

  n162dAssert.match(
    n162dSource,
    /export function createObservationRuntime/,
  );

  n162dAssert.match(
    n162dSource,
    /export const observationRuntime/,
  );


  // ----------------------------------------------------------
  // Bootstrap remains explicit.
  //
  // Exactly one bootstrapObservations invocation is expected:
  // inside the runtime's bootstrap function.
  // ----------------------------------------------------------

  const n162dBootstrapCalls =
    (
      n162dSource.match(
        /\bbootstrapObservations\s*\(/g,
      )
      ?? []
    ).length;

  n162dAssert.equal(
    n162dBootstrapCalls,
    1,
  );

  n162dAssert.match(
    n162dSource,
    /const bootstrap\s*=\s*\([\s\S]*?bootstrapObservations\s*\(/,
  );


  // ----------------------------------------------------------
  // Composition itself owns no transport, timing, retry,
  // presentation, or live-stream capability.
  // ----------------------------------------------------------

  for (const forbidden of [
    "fetch(",
    "EventSource(",
    "WebSocket(",
    "XMLHttpRequest",
    "setInterval(",
    "setTimeout(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
    "react",
  ]) {
    n162dAssert.equal(
      n162dSource.includes(
        forbidden,
      ),
      false,
      `runtime gained forbidden responsibility ${forbidden}`,
    );
  }


  // ----------------------------------------------------------
  // Runtime and concrete reader map are immutable containers.
  // ----------------------------------------------------------

  const freezeCount =
    (
      n162dSource.match(
        /\bObject\.freeze\s*\(/g,
      )
      ?? []
    ).length;

  n162dAssert.equal(
    freezeCount >= 2,
    true,
  );


  console.log(
    "PASS: N16.2d runtime binds exact qualified HTTP readers",
  );

  console.log(
    "PASS: N16.2d runtime binds immutable store to bootstrap coordinator",
  );

  console.log(
    "PASS: N16.2d bootstrap remains explicit with no import-time network activity",
  );

  console.log(
    "PASS: N16.2d runtime adds no transport/timer/retry/React authority",
  );

  console.log(
    "PASS: N16.2d runtime composition containers are immutable",
  );
}


// ============================================================
// N16.2e MANAGED SSE TRANSPORT QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162eFile,

    readdir:
      readN162eDirectory,
  } = await import(
    "node:fs/promises"
  );

  const n162ePath =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162eFileURLToPath,
  } = await import(
    "node:url"
  );

  const n162eAssert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162eTsModule =
    await import(
      "typescript"
    );

  const n162eTs =
    n162eTsModule.default
    ?? n162eTsModule;


  const n162eScriptDirectory =
    n162ePath.dirname(
      n162eFileURLToPath(
        import.meta.url,
      ),
    );

  const n162eUiRoot =
    n162ePath.dirname(
      n162eScriptDirectory,
    );

  const n162eRepositoryRoot =
    n162ePath.dirname(
      n162eUiRoot,
    );

  const n162eFilename =
    n162ePath.join(
      n162eUiRoot,
      "src",
      "api",
      "eventStream.ts",
    );

  const n162eSource =
    await readN162eFile(
      n162eFilename,
      "utf8",
    );


  // ----------------------------------------------------------
  // Load the standalone TypeScript transport.
  // ----------------------------------------------------------

  const n162eTranspiled =
    n162eTs.transpileModule(
      n162eSource,
      {
        compilerOptions: {
          target:
            n162eTs
              .ScriptTarget
              .ES2022,

          module:
            n162eTs
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const n162eModule =
    await import(
      `data:text/javascript;base64,${
        Buffer.from(
          n162eTranspiled,
          "utf8",
        ).toString(
          "base64",
        )
      }`
    );


  // ----------------------------------------------------------
  // Exact browser trusted-event registry.
  // ----------------------------------------------------------

  const expectedEventTypes = [
    "approval.recorded",
    "approval.required",
    "budget.resolved",
    "evidence.promoted",
    "evidence.recorded",
    "execution.cancel_requested",
    "execution.cancel_resolved",
    "execution.completed",
    "execution.failed",
    "execution.prepared",
    "execution.progress_observed",
    "execution.progress_unobservable",
    "execution.stalled",
    "execution.started",
    "execution.timed_out",
    "model.binding_selected",
    "model.load_observed",
    "provider.inventory_observed",
    "request.accepted",
    "request.completed",
    "request.conflict",
    "request.failed",
    "request.indeterminate",
    "request.rejected",
    "request.replayed",
    "routing.decided",
    "task.state_changed",
    "transition.accepted",
    "transition.proposed",
    "transition.rejected",
    "verification.completed",
    "verification.started",
  ];

  n162eAssert.equal(
    expectedEventTypes.length,
    32,
  );

  n162eAssert.deepEqual(
    [
      ...n162eModule
        .TRUSTED_EVENT_TYPES,
    ],
    expectedEventTypes,
  );

  n162eAssert.equal(
    Object.isFrozen(
      n162eModule
        .TRUSTED_EVENT_TYPES,
    ),
    true,
  );


  // ----------------------------------------------------------
  // Cross-language event-vocabulary parity.
  //
  // A backend event added without a browser listener must fail
  // qualification rather than be silently ignored.
  // ----------------------------------------------------------

  const orchestratorSource =
    await readN162eFile(
      n162ePath.join(
        n162eRepositoryRoot,
        "orchestrator.py",
      ),
      "utf8",
    );

  const eventClassStart =
    orchestratorSource.indexOf(
      "class OrchestratorEventType",
    );

  n162eAssert.notEqual(
    eventClassStart,
    -1,
    "OrchestratorEventType class missing",
  );

  const nextClassStart =
    orchestratorSource.indexOf(
      "\nclass ",
      eventClassStart + 1,
    );

  const eventClassSource =
    nextClassStart === -1
      ? orchestratorSource.slice(
          eventClassStart,
        )
      : orchestratorSource.slice(
          eventClassStart,
          nextClassStart,
        );

  const backendEventTypes = [
    ...eventClassSource.matchAll(
      /^\s+[A-Z][A-Z0-9_]*\s*=\s*"([^"]+)"\s*$/gm,
    ),
  ].map(
    (match) => (
      match[1]
    ),
  );

  n162eAssert.equal(
    backendEventTypes.length,
    32,
    "unexpected backend trusted-event vocabulary size",
  );

  n162eAssert.deepEqual(
    [
      ...backendEventTypes,
    ].sort(),
    [
      ...expectedEventTypes,
    ].sort(),
    "frontend named-event listeners must match backend event vocabulary",
  );


  // ----------------------------------------------------------
  // Cursor URL contract.
  // ----------------------------------------------------------

  n162eAssert.equal(
    n162eModule
      .buildEventStreamUrl(
        0,
      ),
    "/api/v1/events/stream?after_event_seq=0",
  );

  n162eAssert.equal(
    n162eModule
      .buildEventStreamUrl(
        42,
      ),
    "/api/v1/events/stream?after_event_seq=42",
  );

  for (const invalidCursor of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    n162eAssert.throws(
      () => (
        n162eModule
          .buildEventStreamUrl(
            invalidCursor,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Deterministic fake EventSource surface.
  // ----------------------------------------------------------

  class FakeEventStreamSource {
    constructor() {
      this.listeners =
        new Map();

      this.closeCount =
        0;
    }

    addEventListener(
      type,
      listener,
    ) {
      const existing =
        this.listeners.get(
          type,
        )
        ?? [];

      existing.push(
        listener,
      );

      this.listeners.set(
        type,
        existing,
      );
    }

    close() {
      this.closeCount += 1;
    }

    emit(
      type,
      event = {},
    ) {
      const listeners =
        this.listeners.get(
          type,
        )
        ?? [];

      for (
        const listener
        of listeners
      ) {
        listener(
          event,
        );
      }
    }
  }


  function openFakeStream(
    {
      cursor = 42,
      onOpen = () => {},
      onFrame = () => {},
      onDisconnect = () => {},
      onProtocolError = () => {},
    } = {},
  ) {
    const urls = [];
    const sources = [];

    const connection =
      n162eModule
        .openEventStream(
          cursor,
          {
            onOpen,
            onFrame,
            onDisconnect,
            onProtocolError,
          },
          (url) => {
            urls.push(
              url,
            );

            const fake =
              new FakeEventStreamSource();

            sources.push(
              fake,
            );

            return fake;
          },
        );

    n162eAssert.equal(
      sources.length,
      1,
    );

    return {
      connection,
      source:
        sources[0],
      urls,
    };
  }


  // ----------------------------------------------------------
  // Every qualified named event receives a listener.
  // ----------------------------------------------------------

  {
    const {
      source,
      urls,
    } = openFakeStream();

    n162eAssert.deepEqual(
      urls,
      [
        "/api/v1/events/stream?after_event_seq=42",
      ],
    );

    const actualListenerTypes =
      [
        ...source
          .listeners
          .keys(),
      ].sort();

    const expectedListenerTypes =
      [
        "error",
        "message",
        "open",
        ...expectedEventTypes,
      ].sort();

    n162eAssert.deepEqual(
      actualListenerTypes,
      expectedListenerTypes,
    );
  }


  // ----------------------------------------------------------
  // Named trusted frame passes through as immutable raw
  // transport envelope.
  // ----------------------------------------------------------

  {
    let opened =
      0;

    const frames = [];

    const {
      connection,
      source,
    } = openFakeStream({
      onOpen() {
        opened += 1;
      },

      onFrame(frame) {
        frames.push(
          frame,
        );
      },
    });

    source.emit(
      "open",
      {},
    );

    n162eAssert.equal(
      opened,
      1,
    );

    source.emit(
      "execution.started",
      {
        lastEventId:
          "43",

        data:
          '{"event_seq":43}',
      },
    );

    n162eAssert.equal(
      frames.length,
      1,
    );

    n162eAssert.deepEqual(
      frames[0],
      {
        eventType:
          "execution.started",

        eventId:
          43,

        data:
          '{"event_seq":43}',
      },
    );

    n162eAssert.equal(
      Object.isFrozen(
        frames[0],
      ),
      true,
    );

    n162eAssert.equal(
      connection.isClosed(),
      false,
    );
  }


  // ----------------------------------------------------------
  // Transport error closes immediately.
  //
  // This suppresses native EventSource automatic reconnect.
  // Disconnect remains transport metadata only.
  // ----------------------------------------------------------

  {
    let disconnects =
      0;

    const {
      connection,
      source,
    } = openFakeStream({
      onDisconnect() {
        disconnects += 1;
      },
    });

    source.emit(
      "error",
      {},
    );

    n162eAssert.equal(
      connection.isClosed(),
      true,
    );

    n162eAssert.equal(
      source.closeCount,
      1,
    );

    n162eAssert.equal(
      disconnects,
      1,
    );

    source.emit(
      "error",
      {},
    );

    n162eAssert.equal(
      source.closeCount,
      1,
    );

    n162eAssert.equal(
      disconnects,
      1,
    );
  }


  // ----------------------------------------------------------
  // Manual close is idempotent.
  // ----------------------------------------------------------

  {
    const {
      connection,
      source,
    } = openFakeStream();

    connection.close();
    connection.close();

    n162eAssert.equal(
      connection.isClosed(),
      true,
    );

    n162eAssert.equal(
      source.closeCount,
      1,
    );
  }


  // ----------------------------------------------------------
  // Non-canonical event id fails closed.
  // ----------------------------------------------------------

  {
    const protocolErrors = [];
    const frames = [];

    const {
      connection,
      source,
    } = openFakeStream({
      onFrame(frame) {
        frames.push(
          frame,
        );
      },

      onProtocolError(code) {
        protocolErrors.push(
          code,
        );
      },
    });

    source.emit(
      "execution.started",
      {
        lastEventId:
          "043",

        data:
          "{}",
      },
    );

    n162eAssert.equal(
      frames.length,
      0,
    );

    n162eAssert.deepEqual(
      protocolErrors,
      [
        "invalid_event_id",
      ],
    );

    n162eAssert.equal(
      connection.isClosed(),
      true,
    );

    n162eAssert.equal(
      source.closeCount,
      1,
    );
  }


  // ----------------------------------------------------------
  // Non-string SSE data fails closed.
  // ----------------------------------------------------------

  {
    const protocolErrors = [];

    const {
      connection,
      source,
    } = openFakeStream({
      onProtocolError(code) {
        protocolErrors.push(
          code,
        );
      },
    });

    source.emit(
      "execution.started",
      {
        lastEventId:
          "43",

        data:
          {
            not:
              "SSE string data",
          },
      },
    );

    n162eAssert.deepEqual(
      protocolErrors,
      [
        "invalid_event_data",
      ],
    );

    n162eAssert.equal(
      connection.isClosed(),
      true,
    );
  }


  // ----------------------------------------------------------
  // Unnamed event violates the qualified named-event contract.
  // ----------------------------------------------------------

  {
    const protocolErrors = [];

    const {
      connection,
      source,
    } = openFakeStream({
      onProtocolError(code) {
        protocolErrors.push(
          code,
        );
      },
    });

    source.emit(
      "message",
      {
        lastEventId:
          "43",

        data:
          "{}",
      },
    );

    n162eAssert.deepEqual(
      protocolErrors,
      [
        "unexpected_unnamed_event",
      ],
    );

    n162eAssert.equal(
      connection.isClosed(),
      true,
    );
  }


  // ----------------------------------------------------------
  // Closed transport cannot emit later trusted frames.
  // ----------------------------------------------------------

  {
    const frames = [];

    const {
      connection,
      source,
    } = openFakeStream({
      onFrame(frame) {
        frames.push(
          frame,
        );
      },
    });

    connection.close();

    source.emit(
      "request.accepted",
      {
        lastEventId:
          "44",

        data:
          "{}",
      },
    );

    n162eAssert.equal(
      frames.length,
      0,
    );
  }


  // ----------------------------------------------------------
  // EventSource authority exists in exactly one frontend
  // source module.
  // ----------------------------------------------------------

  async function collectSourceFiles(
    directory,
  ) {
    const entries =
      await readN162eDirectory(
        directory,
        {
          withFileTypes:
            true,
        },
      );

    const files = [];

    for (
      const entry
      of entries
    ) {
      const fullPath =
        n162ePath.join(
          directory,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        files.push(
          ...await collectSourceFiles(
            fullPath,
          ),
        );
      }
      else if (
        entry.isFile()
      ) {
        files.push(
          fullPath,
        );
      }
    }

    return files;
  }


  const frontendFiles =
    await collectSourceFiles(
      n162ePath.join(
        n162eUiRoot,
        "src",
      ),
    );

  const eventSourceOwners = [];

  for (
    const filename
    of frontendFiles
  ) {
    const content =
      await readN162eFile(
        filename,
        "utf8",
      );

    if (
      /\bnew\s+EventSource\s*\(/.test(
        content,
      )
    ) {
      eventSourceOwners.push(
        n162ePath.relative(
          n162eUiRoot,
          filename,
        ),
      );
    }
  }

  n162eAssert.deepEqual(
    eventSourceOwners,
    [
      n162ePath.join(
        "src",
        "api",
        "eventStream.ts",
      ),
    ],
  );


  // ----------------------------------------------------------
  // Transport-only responsibility boundary.
  // ----------------------------------------------------------

  for (const forbidden of [
    "JSON.parse(",
    "parseOrchestratorEvent",
    "createObservationStore",
    "observationRuntime",
    "bootstrapObservations",
    "dispatch(",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "WebSocket(",
    "XMLHttpRequest",
    "fetch(",
    "useEffect(",
    "useState(",
    'from "react"',
    "from '../state/",
    'from "../state/',
  ]) {
    n162eAssert.equal(
      n162eSource.includes(
        forbidden,
      ),
      false,
      `SSE transport gained forbidden responsibility ${forbidden}`,
    );
  }


  console.log(
    "PASS: N16.2e browser event registry matches all 32 trusted backend event types",
  );

  console.log(
    "PASS: N16.2e uses explicit canonical after_event_seq cursor",
  );

  console.log(
    "PASS: N16.2e registers every named trusted SSE event",
  );

  console.log(
    "PASS: N16.2e transports immutable raw event frames without parsing trusted JSON",
  );

  console.log(
    "PASS: N16.2e closes transport on disconnect to suppress native automatic reconnect",
  );

  console.log(
    "PASS: N16.2e protocol-envelope failures close fail-closed without fabricating events",
  );

  console.log(
    "PASS: N16.2e manual close is idempotent",
  );

  console.log(
    "PASS: N16.2e EventSource authority is isolated to eventStream.ts",
  );

  console.log(
    "PASS: N16.2e owns no retry/timer/store/React authority",
  );
}


// ============================================================
// N16.2f EVENT INGESTION / RECONCILIATION QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162fFile,
  } = await import(
    "node:fs/promises"
  );

  const n162fPath =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162fFileURLToPath,
  } = await import(
    "node:url"
  );

  const n162fAssert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162fTsModule =
    await import(
      "typescript"
    );

  const n162fTs =
    n162fTsModule.default
    ?? n162fTsModule;


  const n162fScriptDirectory =
    n162fPath.dirname(
      n162fFileURLToPath(
        import.meta.url,
      ),
    );

  const n162fUiRoot =
    n162fPath.dirname(
      n162fScriptDirectory,
    );

  const schemaFilename =
    n162fPath.join(
      n162fUiRoot,
      "src",
      "api",
      "schemas.ts",
    );

  const reconcilerFilename =
    n162fPath.join(
      n162fUiRoot,
      "src",
      "state",
      "eventReconciler.ts",
    );


  // ----------------------------------------------------------
  // Compile schema module into an importable data URL.
  // ----------------------------------------------------------

  const schemaSource =
    await readN162fFile(
      schemaFilename,
      "utf8",
    );

  const schemaTranspiled =
    n162fTs.transpileModule(
      schemaSource,
      {
        compilerOptions: {
          target:
            n162fTs
              .ScriptTarget
              .ES2022,

          module:
            n162fTs
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const schemaUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        schemaTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  // ----------------------------------------------------------
  // Compile reconciler with its runtime schema import replaced
  // by the data-URL module above.
  //
  // EventStreamFrame is imported as type-only and disappears
  // during transpilation.
  // ----------------------------------------------------------

  const reconcilerSource = (
    await readN162fFile(
      reconcilerFilename,
      "utf8",
    )
  ).replace(/\r\n/g, "\n");

  n162fAssert.equal(
    reconcilerSource.includes(
      'from "../api/schemas"',
    ),
    true,
  );

  n162fAssert.equal(
    reconcilerSource.includes(
      'import type {\n  EventStreamFrame,\n} from "../api/eventStream";',
    ),
    true,
  );

  const preparedReconciler =
    reconcilerSource.replace(
      '"../api/schemas"',
      JSON.stringify(
        schemaUrl,
      ),
    );

  const reconcilerTranspiled =
    n162fTs.transpileModule(
      preparedReconciler,
      {
        compilerOptions: {
          target:
            n162fTs
              .ScriptTarget
              .ES2022,

          module:
            n162fTs
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const reconcilerUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        reconcilerTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const reconciler =
    await import(
      reconcilerUrl
    );


  // ----------------------------------------------------------
  // Representative canonical trusted event.
  // ----------------------------------------------------------

  function makeEvent(
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        43,

      event_id:
        "evt-43",

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-18T14:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        "x0043",

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        phase:
          "run",

        nested: {
          one:
            1,

          two:
            true,
        },
      },

      ...overrides,
    };
  }


  function makeFrame(
    {
      event =
        makeEvent(),

      eventType =
        event.event_type,

      eventId =
        event.event_seq,

      data =
        JSON.stringify(
          event,
        ),
    } = {},
  ) {
    return {
      eventType,
      eventId,
      data,
    };
  }


  // ----------------------------------------------------------
  // Invalid cursor is programmer error.
  // ----------------------------------------------------------

  for (const cursor of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    n162fAssert.throws(
      () => (
        reconciler
          .reconcileEventFrame(
            makeFrame(),
            cursor,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Invalid JSON.
  // ----------------------------------------------------------

  {
    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame({
            data:
              "{not-json",
          }),
          42,
        );

    n162fAssert.deepEqual(
      result,
      {
        kind:
          "rejected",

        cursor:
          42,

        reason:
          "invalid_json",
      },
    );

    n162fAssert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Structurally invalid event.
  // ----------------------------------------------------------

  {
    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame({
            data:
              JSON.stringify({
                event_seq:
                  43,
              }),
          }),
          42,
        );

    n162fAssert.deepEqual(
      result,
      {
        kind:
          "rejected",

        cursor:
          42,

        reason:
          "invalid_event",
      },
    );
  }


  // ----------------------------------------------------------
  // SSE named-event type must agree with trusted payload.
  // ----------------------------------------------------------

  {
    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame({
            eventType:
              "request.accepted",
          }),
          42,
        );

    n162fAssert.equal(
      result.kind,
      "rejected",
    );

    n162fAssert.equal(
      result.reason,
      "event_type_mismatch",
    );
  }


  // ----------------------------------------------------------
  // SSE id must agree with payload event_seq.
  // ----------------------------------------------------------

  {
    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame({
            eventId:
              44,
          }),
          42,
        );

    n162fAssert.equal(
      result.kind,
      "rejected",
    );

    n162fAssert.equal(
      result.reason,
      "event_seq_mismatch",
    );
  }


  // ----------------------------------------------------------
  // Exact next sequence is accepted and advances only to the
  // observed event sequence.
  // ----------------------------------------------------------

  {
    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame(),
          42,
        );

    n162fAssert.equal(
      result.kind,
      "accepted",
    );

    n162fAssert.equal(
      result.previousCursor,
      42,
    );

    n162fAssert.equal(
      result.nextCursor,
      43,
    );

    n162fAssert.equal(
      result.event.event_seq,
      43,
    );

    n162fAssert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    n162fAssert.equal(
      Object.isFrozen(
        result.event,
      ),
      true,
    );

    n162fAssert.equal(
      Object.isFrozen(
        result.event.payload,
      ),
      true,
    );

    n162fAssert.equal(
      Object.isFrozen(
        result.event.payload.nested,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Forward jump is a gap, not acceptance.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent({
        event_seq:
          45,

        event_id:
          "evt-45",
      });

    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame({
            event,
          }),
          42,
        );

    n162fAssert.equal(
      result.kind,
      "gap",
    );

    n162fAssert.equal(
      result.cursor,
      42,
    );

    n162fAssert.equal(
      result.expectedEventSeq,
      43,
    );

    n162fAssert.equal(
      result.observedEventSeq,
      45,
    );
  }


  // ----------------------------------------------------------
  // Old event without retained identity evidence is replay,
  // never silently duplicate.
  // ----------------------------------------------------------

  {
    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame(),
          43,
        );

    n162fAssert.equal(
      result.kind,
      "replay",
    );

    n162fAssert.equal(
      result.cursor,
      43,
    );
  }


  // ----------------------------------------------------------
  // Retained equivalent event proves duplicate.
  //
  // Payload object key ordering differs intentionally.
  // ----------------------------------------------------------

  {
    const retained =
      makeEvent({
        payload: {
          nested: {
            two:
              true,

            one:
              1,
          },

          phase:
            "run",
        },
      });

    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame(),
          43,
          retained,
        );

    n162fAssert.equal(
      result.kind,
      "duplicate",
    );

    n162fAssert.equal(
      result.event.event_seq,
      43,
    );
  }


  // ----------------------------------------------------------
  // Same sequence with different retained trusted content is a
  // contradiction, not duplicate/replay.
  // ----------------------------------------------------------

  {
    const retained =
      makeEvent({
        event_id:
          "different-event-id",
      });

    const result =
      reconciler
        .reconcileEventFrame(
          makeFrame(),
          43,
          retained,
        );

    n162fAssert.equal(
      result.kind,
      "contradiction",
    );

    n162fAssert.equal(
      result.reason,
      "sequence_collision",
    );

    n162fAssert.equal(
      result.cursor,
      43,
    );

    n162fAssert.equal(
      Object.isFrozen(
        result.knownEvent,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Caller cannot claim unrelated retained evidence belongs to
  // this sequence.
  // ----------------------------------------------------------

  {
    const retained =
      makeEvent({
        event_seq:
          42,

        event_id:
          "evt-42",
      });

    n162fAssert.throws(
      () => (
        reconciler
          .reconcileEventFrame(
            makeFrame(),
            43,
            retained,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Retained evidence cannot be ahead of cursor.
  // ----------------------------------------------------------

  {
    const retained =
      makeEvent();

    n162fAssert.throws(
      () => (
        reconciler
          .reconcileEventFrame(
            makeFrame(),
            42,
            retained,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Event equivalence detects evidence-ref and payload changes.
  // ----------------------------------------------------------

  {
    const first =
      makeEvent();

    const same =
      makeEvent();

    const changedEvidence =
      makeEvent({
        evidence_refs: [
          "evidence-1",
        ],
      });

    const changedPayload =
      makeEvent({
        payload: {
          phase:
            "different",
        },
      });

    n162fAssert.equal(
      reconciler
        .orchestratorEventsEquivalent(
          first,
          same,
        ),
      true,
    );

    n162fAssert.equal(
      reconciler
        .orchestratorEventsEquivalent(
          first,
          changedEvidence,
        ),
      false,
    );

    n162fAssert.equal(
      reconciler
        .orchestratorEventsEquivalent(
          first,
          changedPayload,
        ),
      false,
    );
  }


  // ----------------------------------------------------------
  // Pure responsibility boundary.
  // ----------------------------------------------------------

  for (const forbidden of [
    "EventSource(",
    "openEventStream(",
    "fetch(",
    "WebSocket(",
    "XMLHttpRequest",
    "/api/v1/events",
    "createObservationStore",
    "observationRuntime",
    "dispatch(",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162fAssert.equal(
      reconcilerSource.includes(
        forbidden,
      ),
      false,
      `reconciler gained forbidden responsibility ${forbidden}`,
    );
  }


  console.log(
    "PASS: N16.2f rejects malformed JSON and structurally invalid events",
  );

  console.log(
    "PASS: N16.2f reconciles SSE event name against payload event_type",
  );

  console.log(
    "PASS: N16.2f reconciles SSE id against payload event_seq",
  );

  console.log(
    "PASS: N16.2f accepts only exact next-sequence events",
  );

  console.log(
    "PASS: N16.2f detects forward sequence gaps without repairing them",
  );

  console.log(
    "PASS: N16.2f does not silently equate replay with duplicate",
  );

  console.log(
    "PASS: N16.2f proves duplicate only against retained equivalent event evidence",
  );

  console.log(
    "PASS: N16.2f detects same-sequence contradictory event evidence",
  );

  console.log(
    "PASS: N16.2f owns immutable reconciled events without store mutation",
  );

  console.log(
    "PASS: N16.2f owns no transport/backfill/retry/timer/React authority",
  );
}


// ============================================================
// N16.2g1 GAP-BACKFILL CONTRACT + REPAIR PLANNER QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162g1File,
  } = await import(
    "node:fs/promises"
  );

  const n162g1Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162g1FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162g1Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162g1TsModule =
    await import(
      "typescript"
    );

  const n162g1Ts =
    n162g1TsModule.default
    ?? n162g1TsModule;


  const scriptDirectory =
    n162g1Path.dirname(
      n162g1FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162g1Path.dirname(
      scriptDirectory,
    );

  const schemasFilename =
    n162g1Path.join(
      uiRoot,
      "src",
      "api",
      "schemas.ts",
    );

  const eventPageFilename =
    n162g1Path.join(
      uiRoot,
      "src",
      "api",
      "eventPage.ts",
    );

  const gapRepairFilename =
    n162g1Path.join(
      uiRoot,
      "src",
      "state",
      "gapRepair.ts",
    );


  // ----------------------------------------------------------
  // Compile schemas.
  // ----------------------------------------------------------

  const schemasSource =
    await readN162g1File(
      schemasFilename,
      "utf8",
    );

  const schemasTranspiled =
    n162g1Ts.transpileModule(
      schemasSource,
      {
        compilerOptions: {
          target:
            n162g1Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g1Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const schemasUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        schemasTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  // ----------------------------------------------------------
  // Compile event-page parser against schemas data URL.
  // ----------------------------------------------------------

  const eventPageSource =
    await readN162g1File(
      eventPageFilename,
      "utf8",
    );

  n162g1Assert.equal(
    eventPageSource.includes(
      'from "./schemas"',
    ),
    true,
  );

  const preparedEventPage =
    eventPageSource.replace(
      '"./schemas"',
      JSON.stringify(
        schemasUrl,
      ),
    );

  const eventPageTranspiled =
    n162g1Ts.transpileModule(
      preparedEventPage,
      {
        compilerOptions: {
          target:
            n162g1Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g1Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const eventPageUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        eventPageTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const eventPage =
    await import(
      eventPageUrl
    );


  // ----------------------------------------------------------
  // gapRepair imports are type-only and disappear during TS
  // transpilation, allowing pure standalone qualification.
  // ----------------------------------------------------------

  const gapRepairSource =
    await readN162g1File(
      gapRepairFilename,
      "utf8",
    );

  const gapRepairTranspiled =
    n162g1Ts.transpileModule(
      gapRepairSource,
      {
        compilerOptions: {
          target:
            n162g1Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g1Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const gapRepairUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        gapRepairTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const gapRepair =
    await import(
      gapRepairUrl
    );


  function makeEvent(
    eventSeq,
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        eventSeq,

      event_id:
        `evt-${eventSeq}`,

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-18T14:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        seq:
          eventSeq,
      },

      ...overrides,
    };
  }


  // ----------------------------------------------------------
  // Event page contract: valid contiguous page.
  // ----------------------------------------------------------

  const page4344 =
    eventPage
      .parseEventPageResponse(
        {
          events: [
            makeEvent(
              43,
            ),
            makeEvent(
              44,
            ),
          ],

          count:
            2,

          after_event_seq:
            42,

          next_after_event_seq:
            44,
        },
        42,
        2,
      );

  n162g1Assert.equal(
    page4344.count,
    2,
  );

  n162g1Assert.equal(
    page4344.events[0].event_seq,
    43,
  );

  n162g1Assert.equal(
    page4344.events[1].event_seq,
    44,
  );

  n162g1Assert.equal(
    page4344.next_after_event_seq,
    44,
  );

  n162g1Assert.equal(
    Object.isFrozen(
      page4344,
    ),
    true,
  );

  n162g1Assert.equal(
    Object.isFrozen(
      page4344.events,
    ),
    true,
  );

  n162g1Assert.equal(
    Object.isFrozen(
      page4344.events[0],
    ),
    true,
  );

  n162g1Assert.equal(
    Object.isFrozen(
      page4344.events[0].payload,
    ),
    true,
  );


  // ----------------------------------------------------------
  // Empty page retains the requested cursor.
  // ----------------------------------------------------------

  const emptyPage =
    eventPage
      .parseEventPageResponse(
        {
          events:
            [],

          count:
            0,

          after_event_seq:
            42,

          next_after_event_seq:
            42,
        },
        42,
        2,
      );

  n162g1Assert.equal(
    emptyPage.next_after_event_seq,
    42,
  );


  // ----------------------------------------------------------
  // Fail-closed envelope tests.
  // ----------------------------------------------------------

  n162g1Assert.throws(
    () => (
      eventPage
        .parseEventPageResponse(
          {
            events:
              [],

            count:
              1,

            after_event_seq:
              42,

            next_after_event_seq:
              42,
          },
          42,
          2,
        )
    ),
    TypeError,
  );


  n162g1Assert.throws(
    () => (
      eventPage
        .parseEventPageResponse(
          {
            events: [
              makeEvent(
                44,
              ),
              makeEvent(
                43,
              ),
            ],

            count:
              2,

            after_event_seq:
              42,

            next_after_event_seq:
              43,
          },
          42,
          2,
        )
    ),
    TypeError,
  );


  n162g1Assert.throws(
    () => (
      eventPage
        .parseEventPageResponse(
          {
            events: [
              makeEvent(
                42,
              ),
            ],

            count:
              1,

            after_event_seq:
              42,

            next_after_event_seq:
              42,
          },
          42,
          1,
        )
    ),
    TypeError,
  );


  n162g1Assert.throws(
    () => (
      eventPage
        .parseEventPageResponse(
          {
            events: [
              makeEvent(
                43,
              ),
            ],

            count:
              1,

            after_event_seq:
              42,

            next_after_event_seq:
              99,
          },
          42,
          1,
        )
    ),
    TypeError,
  );


  n162g1Assert.throws(
    () => (
      eventPage
        .parseEventPageResponse(
          {
            events:
              [],

            count:
              0,

            after_event_seq:
              41,

            next_after_event_seq:
              41,
          },
          42,
          1,
        )
    ),
    TypeError,
  );


  n162g1Assert.throws(
    () => (
      eventPage
        .parseEventPageResponse(
          {
            events:
              [],

            count:
              0,

            after_event_seq:
              42,

            next_after_event_seq:
              42,

            unexpected:
              true,
          },
          42,
          1,
        )
    ),
    TypeError,
  );


  // ----------------------------------------------------------
  // Planner: cursor 42 + live 45 means missing 43..44.
  // ----------------------------------------------------------

  const plan =
    gapRepair
      .planGapRepair(
        42,
        45,
      );

  n162g1Assert.deepEqual(
    plan,
    {
      cursor:
        42,

      observedEventSeq:
        45,

      missingFromEventSeq:
        43,

      missingThroughEventSeq:
        44,

      requestAfterEventSeq:
        42,

      requestLimit:
        2,

      batchThroughEventSeq:
        44,
    },
  );

  n162g1Assert.equal(
    Object.isFrozen(
      plan,
    ),
    true,
  );


  // ----------------------------------------------------------
  // Large gap is bounded to one 100-event repair batch.
  // ----------------------------------------------------------

  const largePlan =
    gapRepair
      .planGapRepair(
        42,
        200,
      );

  n162g1Assert.equal(
    largePlan.requestLimit,
    100,
  );

  n162g1Assert.equal(
    largePlan.batchThroughEventSeq,
    142,
  );

  n162g1Assert.equal(
    largePlan.missingThroughEventSeq,
    199,
  );


  // Not a gap.
  n162g1Assert.throws(
    () => (
      gapRepair
        .planGapRepair(
          42,
          43,
        )
    ),
    TypeError,
  );


  // ----------------------------------------------------------
  // Complete repair batch.
  // ----------------------------------------------------------

  {
    const result =
      gapRepair
        .evaluateGapRepairPage(
          plan,
          page4344,
        );

    n162g1Assert.equal(
      result.kind,
      "batch_complete",
    );

    n162g1Assert.equal(
      result.contiguousThroughEventSeq,
      44,
    );

    n162g1Assert.equal(
      result.targetMissingThroughEventSeq,
      44,
    );

    n162g1Assert.equal(
      result.liveObservedEventSeq,
      45,
    );

    n162g1Assert.equal(
      result.evidence.length,
      2,
    );

    n162g1Assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    n162g1Assert.equal(
      Object.isFrozen(
        result.evidence,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Incomplete but contiguous page.
  // ----------------------------------------------------------

  {
    const page43 =
      eventPage
        .parseEventPageResponse(
          {
            events: [
              makeEvent(
                43,
              ),
            ],

            count:
              1,

            after_event_seq:
              42,

            next_after_event_seq:
              43,
          },
          42,
          2,
        );

    const result =
      gapRepair
        .evaluateGapRepairPage(
          plan,
          page43,
        );

    n162g1Assert.equal(
      result.kind,
      "incomplete",
    );

    n162g1Assert.equal(
      result.reason,
      "incomplete_page",
    );

    n162g1Assert.equal(
      result.contiguousThroughEventSeq,
      43,
    );

    n162g1Assert.equal(
      result.expectedEventSeq,
      44,
    );

    n162g1Assert.equal(
      result.observedEventSeq,
      null,
    );
  }


  // ----------------------------------------------------------
  // Empty repair page.
  // ----------------------------------------------------------

  {
    const result =
      gapRepair
        .evaluateGapRepairPage(
          plan,
          emptyPage,
        );

    n162g1Assert.equal(
      result.kind,
      "incomplete",
    );

    n162g1Assert.equal(
      result.reason,
      "empty_page",
    );

    n162g1Assert.equal(
      result.contiguousThroughEventSeq,
      42,
    );

    n162g1Assert.equal(
      result.expectedEventSeq,
      43,
    );
  }


  // ----------------------------------------------------------
  // Still-gapped server evidence.
  //
  // The event page itself is monotonically valid, but does not
  // provide the next required sequence.
  // ----------------------------------------------------------

  {
    const page44 =
      eventPage
        .parseEventPageResponse(
          {
            events: [
              makeEvent(
                44,
              ),
            ],

            count:
              1,

            after_event_seq:
              42,

            next_after_event_seq:
              44,
          },
          42,
          2,
        );

    const result =
      gapRepair
        .evaluateGapRepairPage(
          plan,
          page44,
        );

    n162g1Assert.equal(
      result.kind,
      "incomplete",
    );

    n162g1Assert.equal(
      result.reason,
      "sequence_gap",
    );

    n162g1Assert.equal(
      result.contiguousThroughEventSeq,
      42,
    );

    n162g1Assert.equal(
      result.expectedEventSeq,
      43,
    );

    n162g1Assert.equal(
      result.observedEventSeq,
      44,
    );

    n162g1Assert.equal(
      result.evidence.length,
      0,
    );
  }


  // ----------------------------------------------------------
  // A page for another cursor cannot be applied to this plan.
  // ----------------------------------------------------------

  {
    const unrelated =
      eventPage
        .parseEventPageResponse(
          {
            events:
              [],

            count:
              0,

            after_event_seq:
              41,

            next_after_event_seq:
              41,
          },
          41,
          2,
        );

    n162g1Assert.throws(
      () => (
        gapRepair
          .evaluateGapRepairPage(
            plan,
            unrelated,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Pure responsibility boundaries.
  // ----------------------------------------------------------

  for (
    const [
      label,
      source,
    ]
    of [
      [
        "eventPage",
        eventPageSource,
      ],
      [
        "gapRepair",
        gapRepairSource,
      ],
    ]
  ) {
    for (const forbidden of [
      "fetch(",
      "EventSource(",
      "openEventStream(",
      "WebSocket(",
      "XMLHttpRequest",
      "setTimeout(",
      "setInterval(",
      "Date.now(",
      "performance.now(",
      "createObservationStore",
      "observationRuntime",
      "dispatch(",
      "useEffect(",
      "useState(",
      'from "react"',
    ]) {
      n162g1Assert.equal(
        source.includes(
          forbidden,
        ),
        false,
        `${label} gained forbidden responsibility ${forbidden}`,
      );
    }
  }


  n162g1Assert.equal(
    gapRepairSource.includes(
      "nextCursor",
    ),
    false,
    "gap-repair evidence must not masquerade as cursor mutation",
  );


  console.log(
    "PASS: N16.2g1 validates exact read-only event-page envelopes",
  );

  console.log(
    "PASS: N16.2g1 validates after_event_seq and next_after_event_seq semantics",
  );

  console.log(
    "PASS: N16.2g1 enforces strict ascending event-page sequences",
  );

  console.log(
    "PASS: N16.2g1 creates deterministic bounded repair plans",
  );

  console.log(
    "PASS: N16.2g1 caps one repair batch at 100 events",
  );

  console.log(
    "PASS: N16.2g1 distinguishes complete, incomplete, empty, and still-gapped evidence",
  );

  console.log(
    "PASS: N16.2g1 repair evidence is runtime-immutable",
  );

  console.log(
    "PASS: N16.2g1 performs no cursor or observation-store mutation",
  );

  console.log(
    "PASS: N16.2g1 owns no HTTP/SSE/retry/timer/React authority",
  );
}


// ============================================================
// N16.2g2 BOUNDED EVENT-PAGE HTTP ADAPTER QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162g2File,
  } = await import(
    "node:fs/promises"
  );

  const n162g2Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162g2FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162g2Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162g2TsModule =
    await import(
      "typescript"
    );

  const n162g2Ts =
    n162g2TsModule.default
    ?? n162g2TsModule;


  const scriptDirectory =
    n162g2Path.dirname(
      n162g2FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162g2Path.dirname(
      scriptDirectory,
    );

  const schemasFilename =
    n162g2Path.join(
      uiRoot,
      "src",
      "api",
      "schemas.ts",
    );

  const eventPageFilename =
    n162g2Path.join(
      uiRoot,
      "src",
      "api",
      "eventPage.ts",
    );

  const httpClientFilename =
    n162g2Path.join(
      uiRoot,
      "src",
      "api",
      "httpClient.ts",
    );


  // ----------------------------------------------------------
  // Compile schemas into a standalone data URL.
  // ----------------------------------------------------------

  const schemasSource =
    await readN162g2File(
      schemasFilename,
      "utf8",
    );

  const schemasTranspiled =
    n162g2Ts.transpileModule(
      schemasSource,
      {
        compilerOptions: {
          target:
            n162g2Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g2Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const schemasUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        schemasTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  // ----------------------------------------------------------
  // Compile eventPage against the schemas data URL.
  // ----------------------------------------------------------

  const eventPageSource =
    await readN162g2File(
      eventPageFilename,
      "utf8",
    );

  const preparedEventPage =
    eventPageSource.replace(
      '"./schemas"',
      JSON.stringify(
        schemasUrl,
      ),
    );

  const eventPageTranspiled =
    n162g2Ts.transpileModule(
      preparedEventPage,
      {
        compilerOptions: {
          target:
            n162g2Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g2Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const eventPageUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        eventPageTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  // ----------------------------------------------------------
  // Compile actual httpClient against both qualified modules.
  // ----------------------------------------------------------

  const httpClientSource =
    await readN162g2File(
      httpClientFilename,
      "utf8",
    );

  n162g2Assert.equal(
    (
      httpClientSource.match(
        /\bfetch\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "httpClient must retain exactly one centralized fetch primitive",
  );

  n162g2Assert.equal(
    httpClientSource.includes(
      "parseEventPageResponse",
    ),
    true,
  );

  n162g2Assert.equal(
    httpClientSource.includes(
      "EventPageResponse",
    ),
    true,
  );

  n162g2Assert.equal(
    httpClientSource.includes(
      "export async function readEventPage",
    ),
    true,
  );

  n162g2Assert.match(
    httpClientSource,
    /\/api\/v1\/events\?after_event_seq=\$\{afterEventSeq\}&limit=\$\{limit\}/,
  );


  const preparedHttpClient =
    httpClientSource
      .replace(
        '"./schemas"',
        JSON.stringify(
          schemasUrl,
        ),
      )
      .replace(
        '"./eventPage"',
        JSON.stringify(
          eventPageUrl,
        ),
      );

  const httpClientTranspiled =
    n162g2Ts.transpileModule(
      preparedHttpClient,
      {
        compilerOptions: {
          target:
            n162g2Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g2Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const httpClientUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        httpClientTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const httpClient =
    await import(
      httpClientUrl
    );


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
        "execution.started",

      occurred_at:
        "2026-09-18T14:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        sequence:
          eventSeq,
      },
    };
  }


  const originalFetch =
    globalThis.fetch;


  try {
    // --------------------------------------------------------
    // Valid request:
    // - exact same-origin relative URL
    // - existing GET/no-store/same-origin transport policy
    // - AbortSignal forwarded unchanged
    // - response passed through event-page validator
    // --------------------------------------------------------

    {
      const calls = [];

      globalThis.fetch =
        async (
          endpoint,
          options,
        ) => {
          calls.push({
            endpoint,
            options,
          });

          return {
            ok:
              true,

            async json() {
              return {
                events: [
                  makeEvent(
                    43,
                  ),
                  makeEvent(
                    44,
                  ),
                ],

                count:
                  2,

                after_event_seq:
                  42,

                next_after_event_seq:
                  44,
              };
            },
          };
        };


      const controller =
        new AbortController();


      const page =
        await httpClient
          .readEventPage(
            42,
            2,
            controller.signal,
          );


      n162g2Assert.equal(
        calls.length,
        1,
      );

      n162g2Assert.equal(
        calls[0].endpoint,
        "/api/v1/events?after_event_seq=42&limit=2",
      );

      n162g2Assert.deepEqual(
        calls[0].options,
        {
          method:
            "GET",

          cache:
            "no-store",

          credentials:
            "same-origin",

          headers: {
            Accept:
              "application/json",
          },

          signal:
            controller.signal,
        },
      );

      n162g2Assert.equal(
        page.after_event_seq,
        42,
      );

      n162g2Assert.equal(
        page.next_after_event_seq,
        44,
      );

      n162g2Assert.equal(
        page.count,
        2,
      );

      n162g2Assert.equal(
        page.events[0].event_seq,
        43,
      );

      n162g2Assert.equal(
        page.events[1].event_seq,
        44,
      );

      n162g2Assert.equal(
        Object.isFrozen(
          page,
        ),
        true,
      );

      n162g2Assert.equal(
        Object.isFrozen(
          page.events,
        ),
        true,
      );

      n162g2Assert.equal(
        Object.isFrozen(
          page.events[0],
        ),
        true,
      );
    }


    // --------------------------------------------------------
    // Invalid input must fail before any network activity.
    // --------------------------------------------------------

    {
      let fetchCount =
        0;

      globalThis.fetch =
        async () => {
          fetchCount += 1;

          throw new Error(
            "fetch must not be reached",
          );
        };


      for (
        const [
          afterEventSeq,
          limit,
        ]
        of [
          [
            -1,
            1,
          ],
          [
            1.5,
            1,
          ],
          [
            Number.NaN,
            1,
          ],
          [
            Number.POSITIVE_INFINITY,
            1,
          ],
          [
            Number.MAX_SAFE_INTEGER + 1,
            1,
          ],
          [
            42,
            0,
          ],
          [
            42,
            -1,
          ],
          [
            42,
            1.5,
          ],
          [
            42,
            1001,
          ],
          [
            42,
            Number.NaN,
          ],
        ]
      ) {
        await n162g2Assert.rejects(
          () => (
            httpClient
              .readEventPage(
                afterEventSeq,
                limit,
              )
          ),
          TypeError,
        );
      }


      n162g2Assert.equal(
        fetchCount,
        0,
        "invalid event-page arguments must fail before fetch",
      );
    }


    // --------------------------------------------------------
    // Invalid server envelope must fail through the qualified
    // event-page parser rather than be returned raw.
    // --------------------------------------------------------

    {
      globalThis.fetch =
        async () => ({
          ok:
            true,

          async json() {
            return {
              events: [
                makeEvent(
                  43,
                ),
              ],

              count:
                1,

              after_event_seq:
                41,

              next_after_event_seq:
                43,
            };
          },
        });


      await n162g2Assert.rejects(
        () => (
          httpClient
            .readEventPage(
              42,
              1,
            )
        ),
        TypeError,
      );
    }


    // --------------------------------------------------------
    // Existing HTTP failure semantics remain centralized.
    // --------------------------------------------------------

    {
      globalThis.fetch =
        async () => ({
          ok:
            false,

          async json() {
            return {};
          },
        });


      await n162g2Assert.rejects(
        () => (
          httpClient
            .readEventPage(
              42,
              1,
            )
        ),
        /Control-plane observation request failed/,
      );
    }
  }
  finally {
    globalThis.fetch =
      originalFetch;
  }


  // ----------------------------------------------------------
  // Responsibility boundary.
  // ----------------------------------------------------------

  for (const forbidden of [
    "EventSource(",
    "openEventStream(",
    "WebSocket(",
    "XMLHttpRequest",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "planGapRepair",
    "evaluateGapRepairPage",
    "GapRepairPlan",
    "createObservationStore",
    "observationRuntime",
    "dispatch(",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162g2Assert.equal(
      httpClientSource.includes(
        forbidden,
      ),
      false,
      `httpClient gained forbidden responsibility ${forbidden}`,
    );
  }


  n162g2Assert.equal(
    (
      httpClientSource.match(
        /\bfetch\s*\(/g,
      )
      ?? []
    ).length,
    1,
  );


  console.log(
    "PASS: N16.2g2 retains one centralized browser fetch primitive",
  );

  console.log(
    "PASS: N16.2g2 validates event-page inputs before network activity",
  );

  console.log(
    "PASS: N16.2g2 constructs the exact bounded read-only event-page URL",
  );

  console.log(
    "PASS: N16.2g2 preserves GET/no-store/same-origin HTTP policy",
  );

  console.log(
    "PASS: N16.2g2 forwards AbortSignal unchanged",
  );

  console.log(
    "PASS: N16.2g2 validates every successful event-page response",
  );

  console.log(
    "PASS: N16.2g2 retains centralized HTTP failure semantics",
  );

  console.log(
    "PASS: N16.2g2 owns no repair/SSE/retry/timer/store/React authority",
  );
}


// ============================================================
// N16.2g3 SINGLE-BATCH GAP-REPAIR EXECUTOR QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162g3File,
  } = await import(
    "node:fs/promises"
  );

  const n162g3Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162g3FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162g3Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162g3TsModule =
    await import(
      "typescript"
    );

  const n162g3Ts =
    n162g3TsModule.default
    ?? n162g3TsModule;


  const scriptDirectory =
    n162g3Path.dirname(
      n162g3FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162g3Path.dirname(
      scriptDirectory,
    );

  const gapRepairFilename =
    n162g3Path.join(
      uiRoot,
      "src",
      "state",
      "gapRepair.ts",
    );

  const executorFilename =
    n162g3Path.join(
      uiRoot,
      "src",
      "state",
      "gapRepairExecutor.ts",
    );


  // ----------------------------------------------------------
  // Compile the already-qualified pure gapRepair module.
  //
  // Its imports are type-only and disappear during
  // transpilation.
  // ----------------------------------------------------------

  const gapRepairSource =
    await readN162g3File(
      gapRepairFilename,
      "utf8",
    );

  const gapRepairTranspiled =
    n162g3Ts.transpileModule(
      gapRepairSource,
      {
        compilerOptions: {
          target:
            n162g3Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g3Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const gapRepairUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        gapRepairTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  // ----------------------------------------------------------
  // Substitute a harmless HTTP-client module for dynamic
  // qualification.
  //
  // Behavioral tests inject their own reader. Static checks
  // below verify the production default binding is exactly
  // readEventPage.
  // ----------------------------------------------------------

  const httpStubSource = `
    export async function readEventPage() {
      throw new Error(
        "qualification default reader must not be reached"
      );
    }
  `;

  const httpStubUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        httpStubSource,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  const executorSource =
    await readN162g3File(
      executorFilename,
      "utf8",
    );


  n162g3Assert.equal(
    executorSource.includes(
      'from "../api/httpClient"',
    ),
    true,
  );

  n162g3Assert.equal(
    executorSource.includes(
      'from "./gapRepair"',
    ),
    true,
  );

  n162g3Assert.match(
    executorSource,
    /defaultDependencies[\s\S]*?readEventPage\s*,/,
  );


  const preparedExecutor =
    executorSource
      .replace(
        '"../api/httpClient"',
        JSON.stringify(
          httpStubUrl,
        ),
      )
      .replace(
        '"./gapRepair"',
        JSON.stringify(
          gapRepairUrl,
        ),
      );

  const executorTranspiled =
    n162g3Ts.transpileModule(
      preparedExecutor,
      {
        compilerOptions: {
          target:
            n162g3Ts
              .ScriptTarget
              .ES2022,

          module:
            n162g3Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const executorUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        executorTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const executor =
    await import(
      executorUrl
    );


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
        "execution.started",

      occurred_at:
        "2026-09-18T14:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        sequence:
          eventSeq,
      },
    };
  }


  function makePage(
    afterEventSeq,
    sequences,
  ) {
    return Object.freeze({
      events:
        Object.freeze(
          sequences.map(
            (
              eventSeq,
            ) => (
              Object.freeze(
                makeEvent(
                  eventSeq,
                ),
              )
            ),
          ),
        ),

      count:
        sequences.length,

      after_event_seq:
        afterEventSeq,

      next_after_event_seq:
        sequences.length > 0
          ? sequences[
              sequences.length - 1
            ]
          : afterEventSeq,
    });
  }


  // ----------------------------------------------------------
  // Happy path:
  // cursor 42 + observed live 45 -> request 43..44.
  // Exactly one bounded reader call.
  // ----------------------------------------------------------

  {
    const calls = [];

    const controller =
      new AbortController();

    const result =
      await executor
        .executeGapRepairBatch(
          42,
          45,
          controller.signal,
          {
            async readEventPage(
              afterEventSeq,
              limit,
              signal,
            ) {
              calls.push({
                afterEventSeq,
                limit,
                signal,
              });

              return makePage(
                42,
                [
                  43,
                  44,
                ],
              );
            },
          },
        );


    n162g3Assert.equal(
      calls.length,
      1,
    );

    n162g3Assert.deepEqual(
      calls[0],
      {
        afterEventSeq:
          42,

        limit:
          2,

        signal:
          controller.signal,
      },
    );

    n162g3Assert.equal(
      result.outcome,
      "evaluated",
    );

    n162g3Assert.equal(
      result.plan.cursor,
      42,
    );

    n162g3Assert.equal(
      result.plan.observedEventSeq,
      45,
    );

    n162g3Assert.equal(
      result.plan.requestLimit,
      2,
    );

    n162g3Assert.equal(
      result.evaluation.kind,
      "batch_complete",
    );

    n162g3Assert.equal(
      result.evaluation
        .contiguousThroughEventSeq,
      44,
    );

    n162g3Assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    n162g3Assert.equal(
      Object.isFrozen(
        result.plan,
      ),
      true,
    );

    n162g3Assert.equal(
      Object.isFrozen(
        result.evaluation,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Incomplete evidence remains evaluated/incomplete.
  //
  // Executor must not reinterpret incomplete evidence as
  // successful repair.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    const result =
      await executor
        .executeGapRepairBatch(
          42,
          45,
          undefined,
          {
            async readEventPage() {
              calls += 1;

              return makePage(
                42,
                [
                  43,
                ],
              );
            },
          },
        );


    n162g3Assert.equal(
      calls,
      1,
    );

    n162g3Assert.equal(
      result.outcome,
      "evaluated",
    );

    n162g3Assert.equal(
      result.evaluation.kind,
      "incomplete",
    );

    n162g3Assert.equal(
      result.evaluation.reason,
      "incomplete_page",
    );
  }


  // ----------------------------------------------------------
  // Reader failure becomes an operational failed result.
  //
  // No retry is attempted.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    const result =
      await executor
        .executeGapRepairBatch(
          42,
          45,
          undefined,
          {
            async readEventPage() {
              calls += 1;

              throw new Error(
                "qualification read failure",
              );
            },
          },
        );


    n162g3Assert.equal(
      calls,
      1,
    );

    n162g3Assert.deepEqual(
      result,
      {
        outcome:
          "failed",

        plan:
          result.plan,

        reason:
          "event_page_read_failed",
      },
    );

    n162g3Assert.equal(
      result.plan.cursor,
      42,
    );

    n162g3Assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Already-aborted signal performs no read.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    const controller =
      new AbortController();

    controller.abort();


    const result =
      await executor
        .executeGapRepairBatch(
          42,
          45,
          controller.signal,
          {
            async readEventPage() {
              calls += 1;

              throw new Error(
                "reader must not be reached"
              );
            },
          },
        );


    n162g3Assert.equal(
      calls,
      0,
    );

    n162g3Assert.equal(
      result.outcome,
      "aborted",
    );

    n162g3Assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Abort during failed read is classified aborted, not failed.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    const controller =
      new AbortController();


    const result =
      await executor
        .executeGapRepairBatch(
          42,
          45,
          controller.signal,
          {
            async readEventPage() {
              calls += 1;

              controller.abort();

              throw new Error(
                "simulated aborted read",
              );
            },
          },
        );


    n162g3Assert.equal(
      calls,
      1,
    );

    n162g3Assert.equal(
      result.outcome,
      "aborted",
    );
  }


  // ----------------------------------------------------------
  // Abort after a successful read but before evaluation wins.
  //
  // No retrieved evidence is promoted/applied.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    const controller =
      new AbortController();


    const result =
      await executor
        .executeGapRepairBatch(
          42,
          45,
          controller.signal,
          {
            async readEventPage() {
              calls += 1;

              controller.abort();

              return makePage(
                42,
                [
                  43,
                  44,
                ],
              );
            },
          },
        );


    n162g3Assert.equal(
      calls,
      1,
    );

    n162g3Assert.equal(
      result.outcome,
      "aborted",
    );

    n162g3Assert.equal(
      Object.hasOwn(
        result,
        "evaluation",
      ),
      false,
    );
  }


  // ----------------------------------------------------------
  // Invalid/non-gap input remains a programming error and
  // performs no network read.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    await n162g3Assert.rejects(
      () => (
        executor
          .executeGapRepairBatch(
            42,
            43,
            undefined,
            {
              async readEventPage() {
                calls += 1;

                return makePage(
                  42,
                  [],
                );
              },
            },
          )
      ),
      TypeError,
    );

    n162g3Assert.equal(
      calls,
      0,
    );
  }


  // ----------------------------------------------------------
  // Evaluator contract errors are not hidden as read failures.
  //
  // An injected reader returning a page for another cursor is
  // deliberately invalid. The pure evaluator must reject it.
  // ----------------------------------------------------------

  {
    let calls =
      0;

    await n162g3Assert.rejects(
      () => (
        executor
          .executeGapRepairBatch(
            42,
            45,
            undefined,
            {
              async readEventPage() {
                calls += 1;

                return makePage(
                  41,
                  [
                    42,
                  ],
                );
              },
            },
          )
      ),
      TypeError,
    );

    n162g3Assert.equal(
      calls,
      1,
    );
  }


  // ----------------------------------------------------------
  // Large gaps remain a single bounded batch.
  //
  // No internal loop or retry is allowed.
  // ----------------------------------------------------------

  {
    const calls = [];

    const result =
      await executor
        .executeGapRepairBatch(
          42,
          200,
          undefined,
          {
            async readEventPage(
              afterEventSeq,
              limit,
            ) {
              calls.push({
                afterEventSeq,
                limit,
              });

              const sequences =
                Array.from(
                  {
                    length:
                      100,
                  },
                  (
                    _,
                    index,
                  ) => (
                    43 + index
                  ),
                );

              return makePage(
                42,
                sequences,
              );
            },
          },
        );


    n162g3Assert.equal(
      calls.length,
      1,
    );

    n162g3Assert.deepEqual(
      calls[0],
      {
        afterEventSeq:
          42,

        limit:
          100,
      },
    );

    n162g3Assert.equal(
      result.outcome,
      "evaluated",
    );

    n162g3Assert.equal(
      result.evaluation.kind,
      "batch_complete",
    );

    n162g3Assert.equal(
      result.evaluation
        .contiguousThroughEventSeq,
      142,
    );

    n162g3Assert.equal(
      result.evaluation
        .targetMissingThroughEventSeq,
      199,
    );

    n162g3Assert.notEqual(
      result.evaluation
        .contiguousThroughEventSeq,
      result.evaluation
        .targetMissingThroughEventSeq,
      "batch_complete must not be confused with whole-gap completion",
    );
  }


  // ----------------------------------------------------------
  // Responsibility boundary.
  // ----------------------------------------------------------

  for (const forbidden of [
    "fetch(",
    "EventSource(",
    "openEventStream(",
    "WebSocket(",
    "XMLHttpRequest",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "createObservationStore",
    "observationRuntime",
    "dispatch(",
    "useEffect(",
    "useState(",
    'from "react"',
    "nextCursor",
  ]) {
    n162g3Assert.equal(
      executorSource.includes(
        forbidden,
      ),
      false,
      `gap-repair executor gained forbidden responsibility ${forbidden}`,
    );
  }


  n162g3Assert.equal(
    (
      executorSource.match(
        /\.readEventPage\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "executor must contain exactly one event-page read site",
  );


  console.log(
    "PASS: N16.2g3 composes planner, one bounded reader call, and evaluator",
  );

  console.log(
    "PASS: N16.2g3 preserves incomplete repair evidence without promotion",
  );

  console.log(
    "PASS: N16.2g3 classifies read failure without retry",
  );

  console.log(
    "PASS: N16.2g3 cancellation prevents or suppresses evidence evaluation",
  );

  console.log(
    "PASS: N16.2g3 preserves programming/contract errors as exceptions",
  );

  console.log(
    "PASS: N16.2g3 performs exactly one bounded repair batch",
  );

  console.log(
    "PASS: N16.2g3 does not confuse batch completion with whole-gap repair",
  );

  console.log(
    "PASS: N16.2g3 owns no direct network/SSE/retry/timer/store/React authority",
  );

  console.log(
    "PASS: N16.2g3 exposes no authoritative cursor mutation",
  );
}


// ============================================================
// N16.2h1 SHARED VALIDATED-EVENT RECONCILIATION QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162h1File,
  } = await import(
    "node:fs/promises"
  );

  const n162h1Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162h1FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162h1Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162h1TsModule =
    await import(
      "typescript"
    );

  const n162h1Ts =
    n162h1TsModule.default
    ?? n162h1TsModule;


  const scriptDirectory =
    n162h1Path.dirname(
      n162h1FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162h1Path.dirname(
      scriptDirectory,
    );

  const schemasFilename =
    n162h1Path.join(
      uiRoot,
      "src",
      "api",
      "schemas.ts",
    );

  const reconcilerFilename =
    n162h1Path.join(
      uiRoot,
      "src",
      "state",
      "eventReconciler.ts",
    );


  // ----------------------------------------------------------
  // Compile schemas.
  // ----------------------------------------------------------

  const schemasSource =
    await readN162h1File(
      schemasFilename,
      "utf8",
    );

  const schemasTranspiled =
    n162h1Ts.transpileModule(
      schemasSource,
      {
        compilerOptions: {
          target:
            n162h1Ts
              .ScriptTarget
              .ES2022,

          module:
            n162h1Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const schemasUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        schemasTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;


  // ----------------------------------------------------------
  // Compile actual reconciler against schemas.
  //
  // EventStreamFrame is a type-only import and disappears
  // during TypeScript transpilation.
  // ----------------------------------------------------------

  const reconcilerSource =
    await readN162h1File(
      reconcilerFilename,
      "utf8",
    );

  const preparedReconciler =
    reconcilerSource.replace(
      '"../api/schemas"',
      JSON.stringify(
        schemasUrl,
      ),
    );

  const reconcilerTranspiled =
    n162h1Ts.transpileModule(
      preparedReconciler,
      {
        compilerOptions: {
          target:
            n162h1Ts
              .ScriptTarget
              .ES2022,

          module:
            n162h1Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const reconcilerUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        reconcilerTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const reconciler =
    await import(
      reconcilerUrl
    );


  n162h1Assert.equal(
    typeof reconciler
      .reconcileEventFrame,
    "function",
  );

  n162h1Assert.equal(
    typeof reconciler
      .reconcileValidatedEvent,
    "function",
  );


  function makeEvent(
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        43,

      event_id:
        "evt-43",

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-18T14:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        "x0043",

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        phase:
          "run",

        nested: {
          one:
            1,

          two:
            true,
        },
      },

      ...overrides,
    };
  }


  function makeFrame(
    event,
    overrides = {},
  ) {
    return {
      eventType:
        event.event_type,

      eventId:
        event.event_seq,

      data:
        JSON.stringify(
          event,
        ),

      ...overrides,
    };
  }


  function assertParity(
    event,
    cursor,
    knownEvent = null,
  ) {
    const frameResult =
      reconciler
        .reconcileEventFrame(
          makeFrame(
            event,
          ),
          cursor,
          knownEvent,
        );

    const validatedResult =
      reconciler
        .reconcileValidatedEvent(
          event,
          cursor,
          knownEvent,
        );

    n162h1Assert.deepEqual(
      validatedResult,
      frameResult,
    );

    return {
      frameResult,
      validatedResult,
    };
  }


  // ----------------------------------------------------------
  // Exact-next acceptance parity.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const {
      validatedResult,
    } = assertParity(
      event,
      42,
    );

    n162h1Assert.equal(
      validatedResult.kind,
      "accepted",
    );

    n162h1Assert.equal(
      validatedResult.previousCursor,
      42,
    );

    n162h1Assert.equal(
      validatedResult.nextCursor,
      43,
    );
  }


  // ----------------------------------------------------------
  // Forward-gap parity.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent({
        event_seq:
          45,

        event_id:
          "evt-45",

        execution_id:
          "x0045",
      });

    const {
      validatedResult,
    } = assertParity(
      event,
      42,
    );

    n162h1Assert.equal(
      validatedResult.kind,
      "gap",
    );

    n162h1Assert.equal(
      validatedResult.expectedEventSeq,
      43,
    );

    n162h1Assert.equal(
      validatedResult.observedEventSeq,
      45,
    );
  }


  // ----------------------------------------------------------
  // Replay parity without retained identity evidence.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const {
      validatedResult,
    } = assertParity(
      event,
      43,
    );

    n162h1Assert.equal(
      validatedResult.kind,
      "replay",
    );
  }


  // ----------------------------------------------------------
  // Proven duplicate parity.
  //
  // Payload key order differs intentionally.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const knownEvent =
      makeEvent({
        payload: {
          nested: {
            two:
              true,

            one:
              1,
          },

          phase:
            "run",
        },
      });

    const {
      validatedResult,
    } = assertParity(
      event,
      43,
      knownEvent,
    );

    n162h1Assert.equal(
      validatedResult.kind,
      "duplicate",
    );
  }


  // ----------------------------------------------------------
  // Same-sequence collision parity.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const knownEvent =
      makeEvent({
        event_id:
          "different-event-id",
      });

    const {
      validatedResult,
    } = assertParity(
      event,
      43,
      knownEvent,
    );

    n162h1Assert.equal(
      validatedResult.kind,
      "contradiction",
    );

    n162h1Assert.equal(
      validatedResult.reason,
      "sequence_collision",
    );

    n162h1Assert.equal(
      Object.isFrozen(
        validatedResult.knownEvent,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Invalid cursors remain programmer errors on both paths.
  // ----------------------------------------------------------

  for (const cursor of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const event =
      makeEvent();

    n162h1Assert.throws(
      () => (
        reconciler
          .reconcileEventFrame(
            makeFrame(
              event,
            ),
            cursor,
          )
      ),
      TypeError,
    );

    n162h1Assert.throws(
      () => (
        reconciler
          .reconcileValidatedEvent(
            event,
            cursor,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Retained sequence mismatch remains programmer error.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const knownEvent =
      makeEvent({
        event_seq:
          42,

        event_id:
          "evt-42",

        execution_id:
          "x0042",
      });

    n162h1Assert.throws(
      () => (
        reconciler
          .reconcileEventFrame(
            makeFrame(
              event,
            ),
            43,
            knownEvent,
          )
      ),
      TypeError,
    );

    n162h1Assert.throws(
      () => (
        reconciler
          .reconcileValidatedEvent(
            event,
            43,
            knownEvent,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Retained evidence ahead of cursor remains programmer error.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const knownEvent =
      makeEvent();

    n162h1Assert.throws(
      () => (
        reconciler
          .reconcileEventFrame(
            makeFrame(
              event,
            ),
            42,
            knownEvent,
          )
      ),
      TypeError,
    );

    n162h1Assert.throws(
      () => (
        reconciler
          .reconcileValidatedEvent(
            event,
            42,
            knownEvent,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Validated-event entry point takes ownership of evidence.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const result =
      reconciler
        .reconcileValidatedEvent(
          event,
          42,
        );

    n162h1Assert.equal(
      result.kind,
      "accepted",
    );

    n162h1Assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    n162h1Assert.equal(
      Object.isFrozen(
        result.event,
      ),
      true,
    );

    n162h1Assert.equal(
      Object.isFrozen(
        result.event.payload,
      ),
      true,
    );


    event.payload.phase =
      "mutated-after-reconciliation";

    n162h1Assert.equal(
      result.event.payload.phase,
      "run",
      "validated-event reconciliation must own immutable evidence",
    );
  }


  // ----------------------------------------------------------
  // SSE-specific rejection remains exclusively on frame path.
  // ----------------------------------------------------------

  {
    const event =
      makeEvent();

    const invalidJson =
      reconciler
        .reconcileEventFrame(
          {
            eventType:
              event.event_type,

            eventId:
              event.event_seq,

            data:
              "{not-json",
          },
          42,
        );

    n162h1Assert.deepEqual(
      invalidJson,
      {
        kind:
          "rejected",

        cursor:
          42,

        reason:
          "invalid_json",
      },
    );


    const invalidEvent =
      reconciler
        .reconcileEventFrame(
          {
            eventType:
              event.event_type,

            eventId:
              event.event_seq,

            data:
              JSON.stringify({
                event_seq:
                  43,
              }),
          },
          42,
        );

    n162h1Assert.equal(
      invalidEvent.kind,
      "rejected",
    );

    n162h1Assert.equal(
      invalidEvent.reason,
      "invalid_event",
    );


    const typeMismatch =
      reconciler
        .reconcileEventFrame(
          makeFrame(
            event,
            {
              eventType:
                "request.accepted",
            },
          ),
          42,
        );

    n162h1Assert.equal(
      typeMismatch.kind,
      "rejected",
    );

    n162h1Assert.equal(
      typeMismatch.reason,
      "event_type_mismatch",
    );


    const sequenceMismatch =
      reconciler
        .reconcileEventFrame(
          makeFrame(
            event,
            {
              eventId:
                44,
            },
          ),
          42,
        );

    n162h1Assert.equal(
      sequenceMismatch.kind,
      "rejected",
    );

    n162h1Assert.equal(
      sequenceMismatch.reason,
      "event_seq_mismatch",
    );
  }


  // ----------------------------------------------------------
  // Structural responsibility boundary.
  // ----------------------------------------------------------

  const validatedStart =
    reconcilerSource.indexOf(
      "export function reconcileValidatedEvent(",
    );

  const frameStart =
    reconcilerSource.indexOf(
      "export function reconcileEventFrame(",
    );


  n162h1Assert.notEqual(
    validatedStart,
    -1,
  );

  n162h1Assert.notEqual(
    frameStart,
    -1,
  );

  n162h1Assert.equal(
    validatedStart < frameStart,
    true,
  );


  const validatedSource =
    reconcilerSource.slice(
      validatedStart,
      frameStart,
    );

  const frameSource =
    reconcilerSource.slice(
      frameStart,
    );


  for (const forbidden of [
    "JSON.parse(",
    "parseOrchestratorEvent(",
    "EventStreamFrame",
    "frame.eventType",
    "frame.eventId",
    "fetch(",
    "EventSource(",
    "openEventStream(",
    "readEventPage",
    "executeGapRepairBatch",
    "createObservationStore",
    "observationRuntime",
    "dispatch(",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
  ]) {
    n162h1Assert.equal(
      validatedSource.includes(
        forbidden,
      ),
      false,
      `validated-event core gained forbidden responsibility ${forbidden}`,
    );
  }


  for (const required of [
    "JSON.parse(",
    "parseOrchestratorEvent(",
    "frame.eventType",
    "frame.eventId",
    "reconcileValidatedEvent(",
  ]) {
    n162h1Assert.equal(
      frameSource.includes(
        required,
      ),
      true,
      `frame path lost required boundary ${required}`,
    );
  }


  n162h1Assert.equal(
    (
      reconcilerSource.match(
        /JSON\.parse\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "raw SSE JSON must still be decoded exactly once",
  );


  for (const forbidden of [
    "fetch(",
    "EventSource(",
    "openEventStream(",
    "WebSocket(",
    "XMLHttpRequest",
    "/api/v1/events",
    "readEventPage",
    "executeGapRepairBatch",
    "createObservationStore",
    "observationRuntime",
    "dispatch(",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162h1Assert.equal(
      reconcilerSource.includes(
        forbidden,
      ),
      false,
      `reconciler gained forbidden responsibility ${forbidden}`,
    );
  }


  console.log(
    "PASS: N16.2h1 exposes a shared validated-event reconciliation entry point",
  );

  console.log(
    "PASS: N16.2h1 preserves accepted sequence semantics across SSE and validated-event paths",
  );

  console.log(
    "PASS: N16.2h1 preserves gap semantics across both reconciliation paths",
  );

  console.log(
    "PASS: N16.2h1 preserves replay, duplicate, and contradiction semantics across both paths",
  );

  console.log(
    "PASS: N16.2h1 preserves retained-evidence programming-error semantics",
  );

  console.log(
    "PASS: N16.2h1 validated-event reconciliation owns immutable event evidence",
  );

  console.log(
    "PASS: N16.2h1 keeps JSON and SSE envelope validation exclusively in reconcileEventFrame",
  );

  console.log(
    "PASS: N16.2h1 preserves all SSE-specific rejection semantics",
  );

  console.log(
    "PASS: N16.2h1 introduces no transport/repair/store/timer/React authority",
  );
}


// ============================================================
// N16.2h2 VERIFIED OBSERVATION CURSOR + EVENT WINDOW QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162h2File,
  } = await import(
    "node:fs/promises"
  );

  const n162h2Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162h2FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162h2Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162h2TsModule =
    await import(
      "typescript"
    );

  const n162h2Ts =
    n162h2TsModule.default
    ?? n162h2TsModule;


  const scriptDirectory =
    n162h2Path.dirname(
      n162h2FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162h2Path.dirname(
      scriptDirectory,
    );

  const storeFilename =
    n162h2Path.join(
      uiRoot,
      "src",
      "state",
      "observationStore.ts",
    );


  const storeSource =
    await readN162h2File(
      storeFilename,
      "utf8",
    );


  /*
   * All schema imports remain type-only, so the store can be
   * transpiled as a standalone deterministic reducer for
   * qualification.
   */
  const storeTranspiled =
    n162h2Ts.transpileModule(
      storeSource,
      {
        compilerOptions: {
          target:
            n162h2Ts
              .ScriptTarget
              .ES2022,

          module:
            n162h2Ts
              .ModuleKind
              .ES2022,
        },
      },
    ).outputText;

  const storeUrl =
    `data:text/javascript;base64,${
      Buffer.from(
        storeTranspiled,
        "utf8",
      ).toString(
        "base64",
      )
    }`;

  const storeModule =
    await import(
      storeUrl
    );


  function makeEvent(
    eventSeq,
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        eventSeq,

      event_id:
        `evt-${eventSeq}`,

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-18T14:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        sequence:
          eventSeq,

        nested: {
          value:
            eventSeq,
        },
      },

      ...overrides,
    };
  }


  function makeTail(
    sequences,
  ) {
    return {
      events:
        sequences.map(
          (
            eventSeq,
          ) => (
            makeEvent(
              eventSeq,
            )
          ),
        ),

      count:
        sequences.length,

      limit:
        100,
    };
  }


  // ----------------------------------------------------------
  // Initial state:
  // no baseline means currentEventCursor remains null.
  // ----------------------------------------------------------

  {
    const initial =
      storeModule
        .createInitialObservationState();

    n162h2Assert.equal(
      initial
        .derived
        .bootstrapEventCursor,
      null,
    );

    n162h2Assert.equal(
      initial
        .derived
        .currentEventCursor,
      null,
    );

    n162h2Assert.deepEqual(
      initial
        .observed
        .eventWindow,
      [],
    );

    n162h2Assert.equal(
      Object.isFrozen(
        initial
          .observed
          .eventWindow,
      ),
      true,
    );

    n162h2Assert.equal(
      Object.hasOwn(
        initial.observed,
        "currentEventCursor",
      ),
      false,
    );

    n162h2Assert.equal(
      Object.hasOwn(
        initial.derived,
        "currentEventCursor",
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Non-empty validated bootstrap tail:
  //
  // bootstrap cursor remains historical bootstrap metadata;
  // current cursor begins from the same validated baseline;
  // retained window is seeded from observed evidence.
  // ----------------------------------------------------------

  {
    const store =
      storeModule
        .createObservationStore();

    const tail =
      makeTail(
        [
          41,
          42,
        ],
      );

    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        tail,
    });


    const snapshot =
      store.getSnapshot();


    n162h2Assert.equal(
      snapshot
        .derived
        .bootstrapEventCursor,
      42,
    );

    n162h2Assert.equal(
      snapshot
        .derived
        .currentEventCursor,
      42,
    );

    n162h2Assert.deepEqual(
      snapshot
        .observed
        .eventWindow
        .map(
          (
            event,
          ) => (
            event.event_seq
          ),
        ),
      [
        41,
        42,
      ],
    );

    n162h2Assert.equal(
      snapshot
        .observed
        .eventTail
        .count,
      2,
    );

    n162h2Assert.equal(
      Object.isFrozen(
        snapshot
          .observed
          .eventWindow,
      ),
      true,
    );

    n162h2Assert.equal(
      Object.isFrozen(
        snapshot
          .observed
          .eventWindow[0],
      ),
      true,
    );

    n162h2Assert.equal(
      Object.isFrozen(
        snapshot
          .observed
          .eventWindow[0]
          .payload
          .nested,
      ),
      true,
    );


    /*
     * Bootstrap evidence is store-owned. Mutating the caller's
     * original tail cannot affect either retained window or raw
     * stored eventTail.
     */
    tail
      .events[0]
      .payload
      .nested
      .value = 999;


    n162h2Assert.equal(
      snapshot
        .observed
        .eventWindow[0]
        .payload
        .nested
        .value,
      41,
    );

    n162h2Assert.equal(
      snapshot
        .observed
        .eventTail
        .events[0]
        .payload
        .nested
        .value,
      41,
    );


    // --------------------------------------------------------
    // Exactly-next accepted event advances only the current
    // cursor and retained evidence.
    // --------------------------------------------------------

    const accepted43 =
      makeEvent(
        43,
      );

    store.dispatch({
      type:
        "observation/event-accepted",

      event:
        accepted43,
    });


    const after43 =
      store.getSnapshot();


    n162h2Assert.equal(
      after43
        .derived
        .bootstrapEventCursor,
      42,
      "bootstrap cursor must remain the bootstrap baseline",
    );

    n162h2Assert.equal(
      after43
        .derived
        .currentEventCursor,
      43,
    );

    n162h2Assert.deepEqual(
      after43
        .observed
        .eventWindow
        .map(
          (
            event,
          ) => (
            event.event_seq
          ),
        ),
      [
        41,
        42,
        43,
      ],
    );

    n162h2Assert.equal(
      after43
        .observed
        .eventTail
        .count,
      2,
      "live accepted events must not rewrite the bootstrap eventTail observation",
    );


    accepted43
      .payload
      .nested
      .value = 999;


    n162h2Assert.equal(
      after43
        .observed
        .eventWindow[2]
        .payload
        .nested
        .value,
      43,
      "accepted event evidence must be store-owned",
    );


    // --------------------------------------------------------
    // Replay and gap attempts fail closed and cannot alter the
    // state object or cursor.
    // --------------------------------------------------------

    const stableSnapshot =
      store.getSnapshot();


    n162h2Assert.throws(
      () => (
        store.dispatch({
          type:
            "observation/event-accepted",

          event:
            makeEvent(
              43,
            ),
        })
      ),
      TypeError,
    );


    n162h2Assert.equal(
      store.getSnapshot(),
      stableSnapshot,
      "failed replay-like transition must not replace state",
    );


    n162h2Assert.throws(
      () => (
        store.dispatch({
          type:
            "observation/event-accepted",

          event:
            makeEvent(
              45,
            ),
        })
      ),
      TypeError,
    );


    n162h2Assert.equal(
      store.getSnapshot(),
      stableSnapshot,
      "failed gap transition must not replace state",
    );

    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );
  }


  // ----------------------------------------------------------
  // No bootstrap baseline: accepted live events are forbidden.
  // ----------------------------------------------------------

  {
    const store =
      storeModule
        .createObservationStore();

    const initial =
      store.getSnapshot();


    n162h2Assert.throws(
      () => (
        store.dispatch({
          type:
            "observation/event-accepted",

          event:
            makeEvent(
              1,
            ),
        })
      ),
      TypeError,
    );


    n162h2Assert.equal(
      store.getSnapshot(),
      initial,
    );

    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      null,
    );
  }


  // ----------------------------------------------------------
  // Empty validated bootstrap tail establishes cursor zero.
  // Event 1 may then be accepted.
  // ----------------------------------------------------------

  {
    const store =
      storeModule
        .createObservationStore();


    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        makeTail(
          [],
        ),
    });


    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .bootstrapEventCursor,
      null,
    );

    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      0,
    );

    n162h2Assert.deepEqual(
      store
        .getSnapshot()
        .observed
        .eventWindow,
      [],
    );


    store.dispatch({
      type:
        "observation/event-accepted",

      event:
        makeEvent(
          1,
        ),
    });


    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      1,
    );

    n162h2Assert.deepEqual(
      store
        .getSnapshot()
        .observed
        .eventWindow
        .map(
          (
            event,
          ) => (
            event.event_seq
          ),
        ),
      [
        1,
      ],
    );
  }


  // ----------------------------------------------------------
  // Window remains bounded at exactly 100 retained events.
  // ----------------------------------------------------------

  {
    n162h2Assert.equal(
      storeModule
        .OBSERVATION_EVENT_WINDOW_LIMIT,
      100,
    );


    const store =
      storeModule
        .createObservationStore();

    const bootstrapSequences =
      Array.from(
        {
          length:
            100,
        },
        (
          _,
          index,
        ) => (
          index + 1
        ),
      );


    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        makeTail(
          bootstrapSequences,
        ),
    });


    n162h2Assert.equal(
      store
        .getSnapshot()
        .observed
        .eventWindow
        .length,
      100,
    );

    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      100,
    );


    store.dispatch({
      type:
        "observation/event-accepted",

      event:
        makeEvent(
          101,
        ),
    });


    const window =
      store
        .getSnapshot()
        .observed
        .eventWindow;


    n162h2Assert.equal(
      window.length,
      100,
    );

    n162h2Assert.equal(
      window[0].event_seq,
      2,
    );

    n162h2Assert.equal(
      window[99].event_seq,
      101,
    );

    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .bootstrapEventCursor,
      100,
    );

    n162h2Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      101,
    );
  }


  // ----------------------------------------------------------
  // Failed transitions do not notify subscribers.
  // ----------------------------------------------------------

  {
    const store =
      storeModule
        .createObservationStore();

    let notifications =
      0;

    const unsubscribe =
      store.subscribe(
        () => {
          notifications += 1;
        },
      );


    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        makeTail(
          [
            10,
          ],
        ),
    });


    n162h2Assert.equal(
      notifications,
      1,
    );


    n162h2Assert.throws(
      () => (
        store.dispatch({
          type:
            "observation/event-accepted",

          event:
            makeEvent(
              12,
            ),
        })
      ),
      TypeError,
    );


    n162h2Assert.equal(
      notifications,
      1,
      "failed sequential transition must not notify",
    );


    store.dispatch({
      type:
        "observation/event-accepted",

      event:
        makeEvent(
          11,
        ),
    });


    n162h2Assert.equal(
      notifications,
      2,
    );


    unsubscribe();
  }


  // ----------------------------------------------------------
  // Reset removes both live evidence and current cursor.
  // ----------------------------------------------------------

  {
    const store =
      storeModule
        .createObservationStore();


    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        makeTail(
          [
            41,
            42,
          ],
        ),
    });

    store.dispatch({
      type:
        "observation/event-accepted",

      event:
        makeEvent(
          43,
        ),
    });

    store.dispatch({
      type:
        "observation/reset",
    });


    const reset =
      store.getSnapshot();


    n162h2Assert.equal(
      reset
        .derived
        .bootstrapEventCursor,
      null,
    );

    n162h2Assert.equal(
      reset
        .derived
        .currentEventCursor,
      null,
    );

    n162h2Assert.deepEqual(
      reset
        .observed
        .eventWindow,
      [],
    );

    n162h2Assert.equal(
      reset
        .observed
        .eventTail,
      null,
    );
  }


  // ----------------------------------------------------------
  // Responsibility boundary.
  //
  // Store owns evidence retention and cursor transition only.
  // It does not classify, retrieve, repair, stream, reconnect,
  // time, or render.
  // ----------------------------------------------------------

  for (const forbidden of [
    "reconcileEventFrame",
    "reconcileValidatedEvent",
    "orchestratorEventsEquivalent",
    "openEventStream",
    "EventSource(",
    "readEventPage",
    "executeGapRepairBatch",
    "planGapRepair",
    "evaluateGapRepairPage",
    "fetch(",
    "WebSocket(",
    "XMLHttpRequest",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "reconnect",
    "freshness",
    "stale",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162h2Assert.equal(
      storeSource.includes(
        forbidden,
      ),
      false,
      `observation store gained forbidden responsibility ${forbidden}`,
    );
  }


  n162h2Assert.equal(
    (
      storeSource.match(
        /"observation\/event-accepted"/g,
      )
      ?? []
    ).length,
    2,
    "accepted-event action must appear once in the action type and once in the reducer",
  );


  console.log(
    "PASS: N16.2h2 keeps currentEventCursor in derived browser metadata",
  );

  console.log(
    "PASS: N16.2h2 distinguishes no baseline from validated empty baseline",
  );

  console.log(
    "PASS: N16.2h2 seeds retained evidence from the validated bootstrap event tail",
  );

  console.log(
    "PASS: N16.2h2 advances currentEventCursor only through exact-next accepted-event transitions",
  );

  console.log(
    "PASS: N16.2h2 preserves bootstrapEventCursor as historical bootstrap metadata",
  );

  console.log(
    "PASS: N16.2h2 retains at most 100 immutable observed events",
  );

  console.log(
    "PASS: N16.2h2 rejects replay-like and gap-like store transitions without state mutation",
  );

  console.log(
    "PASS: N16.2h2 failed transitions do not notify subscribers",
  );

  console.log(
    "PASS: N16.2h2 live accepted events do not rewrite the raw bootstrap eventTail observation",
  );

  console.log(
    "PASS: N16.2h2 introduces no reconciliation/transport/repair/timer/freshness/React authority",
  );
}


// ============================================================
// N16.2h3 LIVE OBSERVATION CONTROLLER QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162h3File,
  } = await import(
    "node:fs/promises"
  );

  const n162h3Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162h3FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162h3Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162h3TsModule =
    await import(
      "typescript"
    );

  const n162h3Ts =
    n162h3TsModule.default
    ?? n162h3TsModule;


  const scriptDirectory =
    n162h3Path.dirname(
      n162h3FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162h3Path.dirname(
      scriptDirectory,
    );


  function transpile(
    source,
  ) {
    return n162h3Ts
      .transpileModule(
        source,
        {
          compilerOptions: {
            target:
              n162h3Ts
                .ScriptTarget
                .ES2022,

            module:
              n162h3Ts
                .ModuleKind
                .ES2022,
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


  const schemasFilename =
    n162h3Path.join(
      uiRoot,
      "src",
      "api",
      "schemas.ts",
    );

  const eventStreamFilename =
    n162h3Path.join(
      uiRoot,
      "src",
      "api",
      "eventStream.ts",
    );

  const reconcilerFilename =
    n162h3Path.join(
      uiRoot,
      "src",
      "state",
      "eventReconciler.ts",
    );

  const storeFilename =
    n162h3Path.join(
      uiRoot,
      "src",
      "state",
      "observationStore.ts",
    );

  const controllerFilename =
    n162h3Path.join(
      uiRoot,
      "src",
      "state",
      "observationController.ts",
    );


  const schemasSource =
    await readN162h3File(
      schemasFilename,
      "utf8",
    );

  const schemasUrl =
    moduleUrl(
      transpile(
        schemasSource,
      ),
    );


  const eventStreamSource =
    await readN162h3File(
      eventStreamFilename,
      "utf8",
    );

  const eventStreamUrl =
    moduleUrl(
      transpile(
        eventStreamSource,
      ),
    );


  const reconcilerSource =
    await readN162h3File(
      reconcilerFilename,
      "utf8",
    );

  const preparedReconciler =
    reconcilerSource.replace(
      '"../api/schemas"',
      JSON.stringify(
        schemasUrl,
      ),
    );

  const reconcilerUrl =
    moduleUrl(
      transpile(
        preparedReconciler,
      ),
    );


  const storeSource =
    await readN162h3File(
      storeFilename,
      "utf8",
    );

  const storeUrl =
    moduleUrl(
      transpile(
        storeSource,
      ),
    );


  const controllerSource =
    await readN162h3File(
      controllerFilename,
      "utf8",
    );

  const gapRepairExecutorStubUrl =
    moduleUrl(
      [
        "export async function executeGapRepairBatch() {",
        "  throw new Error(",
        "    'unexpected repair execution in N16.2h3 qualification',",
        "  );",
        "}",
      ].join("\n"),
    );


  const preparedController =
    controllerSource
      .replace(
        '"../api/eventStream"',
        JSON.stringify(
          eventStreamUrl,
        ),
      )
      .replace(
        '"./eventReconciler"',
        JSON.stringify(
          reconcilerUrl,
        ),
      )
      .replace(
        '"./gapRepairExecutor"',
        JSON.stringify(
          gapRepairExecutorStubUrl,
        ),
      );


  const controllerUrl =
    moduleUrl(
      transpile(
        preparedController,
      ),
    );


  const reconciler =
    await import(
      reconcilerUrl
    );

  const storeModule =
    await import(
      storeUrl
    );

  const controllerModule =
    await import(
      controllerUrl
    );


  n162h3Assert.equal(
    typeof controllerModule
      .createObservationController,
    "function",
  );


  function makeEvent(
    eventSeq,
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        eventSeq,

      event_id:
        `evt-${eventSeq}`,

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-19T00:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        sequence:
          eventSeq,
      },

      ...overrides,
    };
  }


  function makeFrame(
    event,
    overrides = {},
  ) {
    return Object.freeze({
      eventType:
        event.event_type,

      eventId:
        event.event_seq,

      data:
        JSON.stringify(
          event,
        ),

      ...overrides,
    });
  }


  function makeTail(
    events,
  ) {
    return {
      events,

      count:
        events.length,

      limit:
        100,
    };
  }


  function seedStore(
    events,
  ) {
    const store =
      storeModule
        .createObservationStore();

    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        makeTail(
          events,
        ),
    });

    return store;
  }


  function createFakeTransport() {
    const sessions =
      [];


    function fakeOpenEventStream(
      cursor,
      handlers,
    ) {
      const session = {
        cursor,
        handlers,
        closed:
          false,
        closeCount:
          0,
        connection:
          null,
      };


      const connection =
        Object.freeze({
          url:
            `/fake?after_event_seq=${cursor}`,

          close() {
            if (
              session.closed
            ) {
              return;
            }

            session.closed =
              true;

            session.closeCount +=
              1;
          },

          isClosed() {
            return session.closed;
          },
        });


      session.connection =
        connection;

      sessions.push(
        session,
      );

      return connection;
    }


    return {
      sessions,

      fakeOpenEventStream,
    };
  }


  function dependenciesFor(
    fakeTransport,
  ) {
    return Object.freeze({
      openEventStream:
        fakeTransport
          .fakeOpenEventStream,

      reconcileEventFrame:
        reconciler
          .reconcileEventFrame,
    });
  }


  // ----------------------------------------------------------
  // No validated baseline => start fails before transport.
  // ----------------------------------------------------------

  {
    const store =
      storeModule
        .createObservationStore();

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );


    n162h3Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "idle",

        sessionGeneration:
          0,

        retainedGapEventSeq:
          null,
      },
    );


    n162h3Assert.throws(
      () => (
        controller.start()
      ),
      TypeError,
    );


    n162h3Assert.equal(
      transport.sessions.length,
      0,
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "idle",
    );
  }


  // ----------------------------------------------------------
  // Start opens exactly one stream from verified store cursor.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          41,
        ),
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );


    controller.start();


    n162h3Assert.equal(
      transport.sessions.length,
      1,
    );

    n162h3Assert.equal(
      transport.sessions[0]
        .cursor,
      42,
    );

    n162h3Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "streaming",

        sessionGeneration:
          1,

        retainedGapEventSeq:
          null,
      },
    );


    /*
     * h3 permits one initial session only. Explicit resumption
     * and creation of later generations belong to a later slice.
     */
    n162h3Assert.throws(
      () => (
        controller.start()
      ),
      TypeError,
    );

    n162h3Assert.equal(
      transport.sessions.length,
      1,
    );


    // --------------------------------------------------------
    // Exact-next live frame is reconciled then applied through
    // the qualified store transition.
    // --------------------------------------------------------

    const session =
      transport.sessions[0];

    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            43,
          ),
        ),
      );


    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );

    n162h3Assert.deepEqual(
      store
        .getSnapshot()
        .observed
        .eventWindow
        .map(
          (
            event,
          ) => (
            event.event_seq
          ),
        ),
      [
        41,
        42,
        43,
      ],
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "streaming",
    );

    n162h3Assert.equal(
      session.closeCount,
      0,
    );


    // --------------------------------------------------------
    // Proven duplicate is observation-only: no store mutation.
    // --------------------------------------------------------

    const beforeDuplicate =
      store.getSnapshot();


    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            43,
          ),
        ),
      );


    n162h3Assert.equal(
      store.getSnapshot(),
      beforeDuplicate,
    );

    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );


    // --------------------------------------------------------
    // Old event outside retained evidence is replay only.
    // --------------------------------------------------------

    const beforeReplay =
      store.getSnapshot();


    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            40,
          ),
        ),
      );


    n162h3Assert.equal(
      store.getSnapshot(),
      beforeReplay,
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "streaming",
    );


    // --------------------------------------------------------
    // Gap immediately stops live consumption and retains only
    // the triggering frame identity.
    // --------------------------------------------------------

    const beforeGap =
      store.getSnapshot();


    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "repairing",
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      45,
    );

    n162h3Assert.equal(
      session.closeCount,
      1,
    );

    n162h3Assert.equal(
      session
        .connection
        .isClosed(),
      true,
    );

    n162h3Assert.equal(
      store.getSnapshot(),
      beforeGap,
      "gap detection must not mutate observation state",
    );

    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );


    // --------------------------------------------------------
    // Callback from terminated stream is stale by controller
    // state and cannot ingest the missing event.
    // --------------------------------------------------------

    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            44,
          ),
        ),
      );


    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "repairing",
    );


    controller.stop();


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "stopped",
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h3Assert.equal(
      session.closeCount,
      1,
      "stop after gap must preserve idempotent connection close",
    );


    controller.stop();

    n162h3Assert.equal(
      session.closeCount,
      1,
      "stop must be idempotent",
    );


    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            44,
          ),
        ),
      );

    session
      .handlers
      .onDisconnect();

    session
      .handlers
      .onProtocolError(
        "invalid_event_id",
      );


    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
      "callbacks after stop must remain inert",
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "stopped",
    );
  }


  // ----------------------------------------------------------
  // Same-sequence conflicting evidence => degraded.
  // ----------------------------------------------------------

  {
    const retained =
      makeEvent(
        43,
      );

    const store =
      seedStore([
        retained,
      ]);

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );

    controller.start();


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            43,
            {
              event_id:
                "different-event-id",
            },
          ),
        ),
      );


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h3Assert.equal(
      transport
        .sessions[0]
        .closeCount,
      1,
    );

    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );
  }


  // ----------------------------------------------------------
  // Rejected SSE payload/envelope reconciliation => degraded.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );

    controller.start();


    const event43 =
      makeEvent(
        43,
      );


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          event43,
          {
            eventType:
              "request.accepted",
          },
        ),
      );


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h3Assert.equal(
      transport
        .sessions[0]
        .closeCount,
      1,
    );

    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Transport disconnect remains transport state only.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const before =
      store.getSnapshot();

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );

    controller.start();


    transport
      .sessions[0]
      .handlers
      .onDisconnect();


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h3Assert.equal(
      transport
        .sessions[0]
        .closeCount,
      1,
    );

    n162h3Assert.equal(
      store.getSnapshot(),
      before,
      "disconnect must not manufacture observation mutation",
    );
  }


  // ----------------------------------------------------------
  // SSE protocol failure => degraded, not disconnected.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const before =
      store.getSnapshot();

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );

    controller.start();


    transport
      .sessions[0]
      .handlers
      .onProtocolError(
        "invalid_event_id",
      );


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h3Assert.equal(
      transport
        .sessions[0]
        .closeCount,
      1,
    );

    n162h3Assert.equal(
      store.getSnapshot(),
      before,
    );
  }


  // ----------------------------------------------------------
  // Store baseline removed while stream exists => degraded.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      controllerModule
        .createObservationController(
          store,
          dependenciesFor(
            transport,
          ),
        );

    controller.start();


    store.dispatch({
      type:
        "observation/reset",
    });


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            43,
          ),
        ),
      );


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h3Assert.equal(
      transport
        .sessions[0]
        .closeCount,
      1,
    );

    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      null,
    );
  }


  // ----------------------------------------------------------
  // Synchronous transport-construction failure is surfaced but
  // leaves controller explicitly disconnected.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const failure =
      new Error(
        "qualification open failure",
      );

    const controller =
      controllerModule
        .createObservationController(
          store,
          {
            openEventStream() {
              throw failure;
            },

            reconcileEventFrame:
              reconciler
                .reconcileEventFrame,
          },
        );


    n162h3Assert.throws(
      () => (
        controller.start()
      ),
      (
        error,
      ) => (
        error === failure
      ),
    );


    n162h3Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h3Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
    );

    n162h3Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Controller responsibility boundary.
  // ----------------------------------------------------------

  for (const required of [
    "openEventStream",
    "reconcileEventFrame",
    '"observation/event-accepted"',
    "currentEventCursor",
    "eventWindow",
    "sessionGeneration",
    "retainedGapFrame",
    '"idle"',
    '"streaming"',
    '"repairing"',
    '"disconnected"',
    '"degraded"',
    '"stopped"',
  ]) {
    n162h3Assert.equal(
      controllerSource.includes(
        required,
      ),
      true,
      `controller missing required responsibility ${required}`,
    );
  }


  for (const forbidden of [
    "readEventPage",
    "planGapRepair",
    "evaluateGapRepairPage",
    "fetch(",
    "WebSocket(",
    "XMLHttpRequest",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162h3Assert.equal(
      controllerSource.includes(
        forbidden,
      ),
      false,
      `controller gained premature responsibility ${forbidden}`,
    );
  }


  n162h3Assert.equal(
    (
      controllerSource.match(
        /\.openEventStream\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "controller must have exactly one stream-open call site",
  );


  n162h3Assert.equal(
    (
      controllerSource.match(
        /\.reconcileEventFrame\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "controller must have exactly one frame-reconciliation call site",
  );


  n162h3Assert.equal(
    (
      controllerSource.match(
        /\.dispatch\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "controller must have exactly one observation-store mutation call site",
  );


  console.log(
    "PASS: N16.2h3 controller requires a validated event-tail baseline before opening SSE",
  );

  console.log(
    "PASS: N16.2h3 opens exactly one initial stream from currentEventCursor",
  );

  console.log(
    "PASS: N16.2h3 accepted live events advance only through the qualified store transition",
  );

  console.log(
    "PASS: N16.2h3 duplicate and replay classifications do not mutate observation state",
  );

  console.log(
    "PASS: N16.2h3 gap detection closes live SSE, retains the trigger, and enters repairing",
  );

  console.log(
    "PASS: N16.2h3 contradiction, rejection, and protocol failure fail closed as degraded",
  );

  console.log(
    "PASS: N16.2h3 transport disconnect remains distinct from degraded integrity state",
  );

  console.log(
    "PASS: N16.2h3 callbacks from a terminated session cannot mutate the store",
  );

  console.log(
    "PASS: N16.2h3 establishes a session-generation token without introducing resume policy",
  );

  console.log(
    "PASS: N16.2h3 dependency-isolated path remains valid without repair/timer/freshness/React authority",
  );
}


// ============================================================
// N16.2h4 BOUNDED MULTI-BATCH GAP REPAIR QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162h4File,
  } = await import(
    "node:fs/promises"
  );

  const n162h4Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162h4FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162h4Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162h4TsModule =
    await import(
      "typescript"
    );

  const n162h4Ts =
    n162h4TsModule.default
    ?? n162h4TsModule;


  const scriptDirectory =
    n162h4Path.dirname(
      n162h4FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162h4Path.dirname(
      scriptDirectory,
    );


  function transpile(
    source,
  ) {
    return n162h4Ts
      .transpileModule(
        source,
        {
          compilerOptions: {
            target:
              n162h4Ts
                .ScriptTarget
                .ES2022,

            module:
              n162h4Ts
                .ModuleKind
                .ES2022,
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


  const schemasSource =
    await readN162h4File(
      n162h4Path.join(
        uiRoot,
        "src",
        "api",
        "schemas.ts",
      ),
      "utf8",
    );

  const eventStreamSource =
    await readN162h4File(
      n162h4Path.join(
        uiRoot,
        "src",
        "api",
        "eventStream.ts",
      ),
      "utf8",
    );

  const reconcilerSource =
    await readN162h4File(
      n162h4Path.join(
        uiRoot,
        "src",
        "state",
        "eventReconciler.ts",
      ),
      "utf8",
    );

  const storeSource =
    await readN162h4File(
      n162h4Path.join(
        uiRoot,
        "src",
        "state",
        "observationStore.ts",
      ),
      "utf8",
    );

  const gapRepairSource =
    await readN162h4File(
      n162h4Path.join(
        uiRoot,
        "src",
        "state",
        "gapRepair.ts",
      ),
      "utf8",
    );

  const controllerSource =
    await readN162h4File(
      n162h4Path.join(
        uiRoot,
        "src",
        "state",
        "observationController.ts",
      ),
      "utf8",
    );


  const schemasUrl =
    moduleUrl(
      transpile(
        schemasSource,
      ),
    );

  const eventStreamUrl =
    moduleUrl(
      transpile(
        eventStreamSource,
      ),
    );

  const reconcilerUrl =
    moduleUrl(
      transpile(
        reconcilerSource.replace(
          '"../api/schemas"',
          JSON.stringify(
            schemasUrl,
          ),
        ),
      ),
    );

  const storeUrl =
    moduleUrl(
      transpile(
        storeSource,
      ),
    );


  /*
   * Explicit injected repair executors are used below.
   * This module merely resolves the production import and must
   * never perform real HTTP work in qualification.
   */
  const executorStubUrl =
    moduleUrl(
      [
        "export async function executeGapRepairBatch() {",
        "  throw new Error(",
        "    'default repair executor must not run in h4 qualification',",
        "  );",
        "}",
      ].join("\n"),
    );


  const controllerUrl =
    moduleUrl(
      transpile(
        controllerSource
          .replace(
            '"../api/eventStream"',
            JSON.stringify(
              eventStreamUrl,
            ),
          )
          .replace(
            '"./eventReconciler"',
            JSON.stringify(
              reconcilerUrl,
            ),
          )
          .replace(
            '"./gapRepairExecutor"',
            JSON.stringify(
              executorStubUrl,
            ),
          ),
      ),
    );


  const reconciler =
    await import(
      reconcilerUrl
    );

  const storeModule =
    await import(
      storeUrl
    );

  const controllerModule =
    await import(
      controllerUrl
    );


  // ----------------------------------------------------------
  // Fixed repair bounds.
  // ----------------------------------------------------------

  n162h4Assert.equal(
    controllerModule
      .MAX_REPAIR_BATCHES_PER_GAP,
    10,
  );


  const repairLimitMatch =
    gapRepairSource.match(
      /GAP_REPAIR_BATCH_LIMIT\s*=\s*\n?\s*(\d+)\s*;/,
    );


  n162h4Assert.notEqual(
    repairLimitMatch,
    null,
  );

  n162h4Assert.equal(
    Number(
      repairLimitMatch[1],
    ),
    100,
  );

  n162h4Assert.equal(
    controllerModule
      .MAX_REPAIR_BATCHES_PER_GAP
      * Number(
          repairLimitMatch[1],
        ),
    1000,
  );


  function makeEvent(
    eventSeq,
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        eventSeq,

      event_id:
        `evt-${eventSeq}`,

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-19T01:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        sequence:
          eventSeq,
      },

      ...overrides,
    };
  }


  function makeFrame(
    event,
    overrides = {},
  ) {
    return Object.freeze({
      eventType:
        event.event_type,

      eventId:
        event.event_seq,

      data:
        JSON.stringify(
          event,
        ),

      ...overrides,
    });
  }


  function seedStore(
    events,
  ) {
    const store =
      storeModule
        .createObservationStore();

    store.dispatch({
      type:
        "observation/event-tail",

      observation: {
        events,

        count:
          events.length,

        limit:
          100,
      },
    });

    return store;
  }


  function createFakeTransport() {
    const sessions =
      [];


    function open(
      cursor,
      handlers,
    ) {
      const session = {
        cursor,

        handlers,

        closed:
          false,

        closeCount:
          0,

        connection:
          null,
      };


      const connection =
        Object.freeze({
          url:
            `/fake?after_event_seq=${cursor}`,

          close() {
            if (
              session.closed
            ) {
              return;
            }

            session.closed =
              true;

            session.closeCount +=
              1;
          },

          isClosed() {
            return session.closed;
          },
        });


      session.connection =
        connection;

      sessions.push(
        session,
      );

      return connection;
    }


    return {
      sessions,
      open,
    };
  }


  function makePlan(
    cursor,
    liveObservedEventSeq,
  ) {
    const missingThroughEventSeq =
      liveObservedEventSeq - 1;

    const missingCount =
      missingThroughEventSeq
      - cursor;

    const requestLimit =
      Math.min(
        missingCount,
        100,
      );

    return {
      cursor,

      observedEventSeq:
        liveObservedEventSeq,

      missingFromEventSeq:
        cursor + 1,

      missingThroughEventSeq,

      requestAfterEventSeq:
        cursor,

      requestLimit,

      batchThroughEventSeq:
        cursor + requestLimit,
    };
  }


  function sequenceRange(
    first,
    last,
  ) {
    return Array.from(
      {
        length:
          last - first + 1,
      },
      (
        _,
        index,
      ) => (
        first + index
      ),
    );
  }


  function makeBatchComplete(
    cursor,
    liveObservedEventSeq,
  ) {
    const plan =
      makePlan(
        cursor,
        liveObservedEventSeq,
      );

    return {
      outcome:
        "evaluated",

      plan,

      evaluation: {
        kind:
          "batch_complete",

        evidence:
          sequenceRange(
            cursor + 1,
            plan.batchThroughEventSeq,
          ).map(
            (
              eventSeq,
            ) => (
              makeEvent(
                eventSeq,
              )
            ),
          ),

        contiguousThroughEventSeq:
          plan.batchThroughEventSeq,

        targetMissingThroughEventSeq:
          plan.missingThroughEventSeq,

        liveObservedEventSeq,
      },
    };
  }


  function automaticRepairExecutor(
    calls,
  ) {
    return async (
      cursor,
      liveObservedEventSeq,
      signal,
    ) => {
      calls.push({
        cursor,

        liveObservedEventSeq,

        signal,
      });


      if (
        signal?.aborted
      ) {
        return {
          outcome:
            "aborted",

          plan:
            makePlan(
              cursor,
              liveObservedEventSeq,
            ),
        };
      }


      return makeBatchComplete(
        cursor,
        liveObservedEventSeq,
      );
    };
  }


  function createController(
    store,
    transport,
    repairExecutor,
    validatedReconciler =
      reconciler
        .reconcileValidatedEvent,
  ) {
    return controllerModule
      .createObservationController(
        store,
        {
          openEventStream:
            transport.open,

          reconcileEventFrame:
            reconciler
              .reconcileEventFrame,

          executeGapRepairBatch:
            repairExecutor,

          reconcileValidatedEvent:
            validatedReconciler,
        },
      );
  }


  async function waitUntil(
    predicate,
    message,
    turns = 300,
  ) {
    for (
      let turn = 0;
      turn < turns;
      turn += 1
    ) {
      if (
        predicate()
      ) {
        return;
      }

      await Promise.resolve();
    }

    n162h4Assert.fail(
      message,
    );
  }


  // ----------------------------------------------------------
  // Repair dependencies are an all-or-none capability.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();


    n162h4Assert.throws(
      () => (
        controllerModule
          .createObservationController(
            store,
            {
              openEventStream:
                transport.open,

              reconcileEventFrame:
                reconciler
                  .reconcileEventFrame,

              executeGapRepairBatch:
                async () => {
                  throw new Error(
                    "unused",
                  );
                },
            },
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Small gap:
  //
  // cursor 42
  // live frame 45
  // repair 43,44
  // retained frame 45
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const repairCalls =
      [];

    const reconciledRepairEvents =
      [];


    const controller =
      createController(
        store,
        transport,
        automaticRepairExecutor(
          repairCalls,
        ),
        (
          event,
          cursor,
          knownEvent,
        ) => {
          reconciledRepairEvents.push(
            event.event_seq,
          );

          return reconciler
            .reconcileValidatedEvent(
              event,
              cursor,
              knownEvent,
            );
        },
      );


    controller.start();


    const session =
      transport.sessions[0];


    session
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "repairing",
    );

    n162h4Assert.equal(
      session.closeCount,
      1,
      "live SSE must close before asynchronous repair",
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
      "gap detection itself must not advance cursor",
    );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "small-gap repair did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      45,
    );

    n162h4Assert.deepEqual(
      store
        .getSnapshot()
        .observed
        .eventWindow
        .map(
          (
            event,
          ) => (
            event.event_seq
          ),
        ),
      [
        42,
        43,
        44,
        45,
      ],
    );

    n162h4Assert.deepEqual(
      reconciledRepairEvents,
      [
        43,
        44,
      ],
      "each repaired event must pass validated-event reconciliation",
    );

    n162h4Assert.equal(
      repairCalls.length,
      1,
    );

    n162h4Assert.equal(
      repairCalls[0].cursor,
      42,
    );

    n162h4Assert.equal(
      transport.sessions.length,
      1,
      "successful h4 repair must not reopen SSE",
    );
  }


  // ----------------------------------------------------------
  // True multi-batch reconstruction:
  //
  // 42 -> live 200
  // batch 1: 43..142
  // batch 2: 143..199
  // retained frame: 200
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const repairCalls =
      [];

    let reconciledCount =
      0;


    const controller =
      createController(
        store,
        transport,
        automaticRepairExecutor(
          repairCalls,
        ),
        (
          event,
          cursor,
          knownEvent,
        ) => {
          reconciledCount +=
            1;

          return reconciler
            .reconcileValidatedEvent(
              event,
              cursor,
              knownEvent,
            );
        },
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            200,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "multi-batch repair did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h4Assert.deepEqual(
      repairCalls.map(
        (
          call,
        ) => (
          call.cursor
        ),
      ),
      [
        42,
        142,
      ],
      "each next batch must start at verified store cursor",
    );

    n162h4Assert.equal(
      reconciledCount,
      157,
      "events 43 through 199 must each be reconciled",
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      200,
    );


    const window =
      store
        .getSnapshot()
        .observed
        .eventWindow;


    n162h4Assert.equal(
      window.length,
      100,
    );

    n162h4Assert.equal(
      window[0].event_seq,
      101,
    );

    n162h4Assert.equal(
      window[99].event_seq,
      200,
    );

    n162h4Assert.equal(
      transport.sessions.length,
      1,
    );
  }


  // ----------------------------------------------------------
  // Incomplete batch evidence is not partially promoted.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
        ) => {
          const plan =
            makePlan(
              cursor,
              liveObservedEventSeq,
            );

          return {
            outcome:
              "evaluated",

            plan,

            evaluation: {
              kind:
                "incomplete",

              reason:
                "incomplete_page",

              evidence: [
                makeEvent(
                  43,
                ),
              ],

              contiguousThroughEventSeq:
                43,

              expectedEventSeq:
                44,

              observedEventSeq:
                null,

              targetMissingThroughEventSeq:
                44,

              liveObservedEventSeq,
            },
          };
        },
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "incomplete repair did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      45,
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
      "incomplete prefix must not be promoted",
    );
  }


  // ----------------------------------------------------------
  // Event-page read failure:
  // disconnected + unresolved retained gap.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
        ) => ({
          outcome:
            "failed",

          plan:
            makePlan(
              cursor,
              liveObservedEventSeq,
            ),

          reason:
            "event_page_read_failed",
        }),
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "failed repair did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      45,
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Executor abort => stopped.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
        ) => ({
          outcome:
            "aborted",

          plan:
            makePlan(
              cursor,
              liveObservedEventSeq,
            ),
        }),
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "aborted repair did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "stopped",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Repair/evaluator contract exception => degraded.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();


    const controller =
      createController(
        store,
        transport,
        async () => {
          throw new TypeError(
            "qualification repair contract fault",
          );
        },
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "contract-fault repair did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      45,
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Batch metadata cannot bypass event reconciliation.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
        ) => {
          const plan =
            makePlan(
              cursor,
              liveObservedEventSeq,
            );

          return {
            outcome:
              "evaluated",

            plan,

            evaluation: {
              kind:
                "batch_complete",

              /*
               * Count/through metadata looks internally complete,
               * but 44 is not the exact-next event after cursor 42.
               */
              evidence: [
                makeEvent(
                  44,
                ),
                makeEvent(
                  44,
                ),
              ],

              contiguousThroughEventSeq:
                44,

              targetMissingThroughEventSeq:
                44,

              liveObservedEventSeq,
            },
          };
        },
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "invalid repair evidence did not settle",
    );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
      "batch metadata must never bypass event reconciliation/store authority",
    );
  }


  // ----------------------------------------------------------
  // Hard 1000-missing-event safety bound.
  //
  // 42 -> live 1044 = missing 43..1043 = 1001 events.
  // Ten 100-event batches may only reach cursor 1042.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const repairCalls =
      [];


    const controller =
      createController(
        store,
        transport,
        automaticRepairExecutor(
          repairCalls,
        ),
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            1044,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "bounded repair did not settle",
      400,
    );


    n162h4Assert.equal(
      repairCalls.length,
      10,
      "an eleventh automatic repair batch must not execute",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      1044,
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      1042,
      "only 1000 individually verified events may advance the cursor",
    );

    n162h4Assert.equal(
      transport.sessions.length,
      1,
    );
  }


  // ----------------------------------------------------------
  // Stop during an in-flight repair:
  // abort repair and ignore stale completion.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    let resolveExecution =
      null;

    let observedSignal =
      null;


    const controller =
      createController(
        store,
        transport,
        (
          cursor,
          liveObservedEventSeq,
          signal,
        ) => {
          observedSignal =
            signal;

          return new Promise(
            (
              resolve,
            ) => {
              resolveExecution =
                () => {
                  resolve({
                    outcome:
                      "aborted",

                    plan:
                      makePlan(
                        cursor,
                        liveObservedEventSeq,
                      ),
                  });
                };
            },
          );
        },
      );


    controller.start();

    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "repairing",
    );

    n162h4Assert.notEqual(
      observedSignal,
      null,
    );

    n162h4Assert.equal(
      observedSignal.aborted,
      false,
    );


    controller.stop();


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "stopped",
    );

    n162h4Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h4Assert.equal(
      observedSignal.aborted,
      true,
      "stop must abort in-flight repair",
    );


    resolveExecution();

    await Promise.resolve();
    await Promise.resolve();


    n162h4Assert.equal(
      controller
        .getSnapshot()
        .state,
      "stopped",
      "stale repair completion must not overwrite stopped state",
    );

    n162h4Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Structural authority qualification.
  // ----------------------------------------------------------

  for (const required of [
    "MAX_REPAIR_BATCHES_PER_GAP",
    "executeGapRepairBatch",
    "reconcileValidatedEvent",
    "runGapRepair",
    "beginGapRepair",
    "repairAbortController",
    '"observation/event-accepted"',
    "currentEventCursor",
    "retainedGapFrame",
  ]) {
    n162h4Assert.equal(
      controllerSource.includes(
        required,
      ),
      true,
      `h4 controller missing ${required}`,
    );
  }


  /*
   * nextCursor from reconcileValidatedEvent is permitted as
   * verification metadata. HTTP next_after_event_seq is not.
   */
  n162h4Assert.equal(
    (
      controllerSource.match(
        /reconciled\.nextCursor/g,
      )
      ?? []
    ).length,
    2,
    "reconciler nextCursor must remain verification-only metadata",
  );


  for (const forbidden of [
    "readEventPage",
    "planGapRepair",
    "evaluateGapRepairPage",
    "next_after_event_seq",
    "fetch(",
    "WebSocket(",
    "XMLHttpRequest",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162h4Assert.equal(
      controllerSource.includes(
        forbidden,
      ),
      false,
      `h4 controller gained forbidden responsibility ${forbidden}`,
    );
  }


  n162h4Assert.equal(
    (
      controllerSource.match(
        /\.openEventStream\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "h4 must not introduce stream reopen",
  );


  n162h4Assert.equal(
    (
      controllerSource.match(
        /\.dispatch\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "all accepted evidence must share one store mutation site",
  );


  n162h4Assert.equal(
    (
      controllerSource.match(
        /\brepairExecutor\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "controller must have one bounded repair-executor call site",
  );


  console.log(
    "PASS: N16.2h4 composes qualified single-batch repair into bounded multi-batch repair",
  );

  console.log(
    "PASS: N16.2h4 closes live SSE before repair retrieval begins",
  );

  console.log(
    "PASS: N16.2h4 reconciles every repaired event before exact-next store promotion",
  );

  console.log(
    "PASS: N16.2h4 permits reconciler nextCursor only as transition verification metadata",
  );

  console.log(
    "PASS: N16.2h4 never advances currentEventCursor from HTTP page or batch metadata",
  );

  console.log(
    "PASS: N16.2h4 does not confuse batch_complete with whole-gap completion",
  );

  console.log(
    "PASS: N16.2h4 applies retained live evidence only after the missing range is complete",
  );

  console.log(
    "PASS: N16.2h4 bounds automatic repair to ten 100-event batches",
  );

  console.log(
    "PASS: N16.2h4 maps read failure to disconnected, abort to stopped, and integrity faults to degraded",
  );

  console.log(
    "PASS: N16.2h4 preserves unresolved retained-gap identity after failed repair",
  );

  console.log(
    "PASS: N16.2h4 successful repair clears retained-gap identity and remains disconnected",
  );

  console.log(
    "PASS: N16.2h4 stop aborts in-flight repair and stale completion remains inert",
  );

  console.log(
    "PASS: N16.2h4 introduces no reopen/retry/timer/freshness/React authority",
  );
}


// ============================================================
// N16.2h5 EXPLICIT CONTINUATION + SESSION GENERATION QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162h5File,
  } = await import(
    "node:fs/promises"
  );

  const n162h5Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162h5FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162h5Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162h5TsModule =
    await import(
      "typescript"
    );

  const n162h5Ts =
    n162h5TsModule.default
    ?? n162h5TsModule;


  const scriptDirectory =
    n162h5Path.dirname(
      n162h5FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162h5Path.dirname(
      scriptDirectory,
    );


  function transpile(
    source,
  ) {
    return n162h5Ts
      .transpileModule(
        source,
        {
          compilerOptions: {
            target:
              n162h5Ts
                .ScriptTarget
                .ES2022,

            module:
              n162h5Ts
                .ModuleKind
                .ES2022,
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


  const schemasSource =
    await readN162h5File(
      n162h5Path.join(
        uiRoot,
        "src",
        "api",
        "schemas.ts",
      ),
      "utf8",
    );

  const eventStreamSource =
    await readN162h5File(
      n162h5Path.join(
        uiRoot,
        "src",
        "api",
        "eventStream.ts",
      ),
      "utf8",
    );

  const reconcilerSource =
    await readN162h5File(
      n162h5Path.join(
        uiRoot,
        "src",
        "state",
        "eventReconciler.ts",
      ),
      "utf8",
    );

  const storeSource =
    await readN162h5File(
      n162h5Path.join(
        uiRoot,
        "src",
        "state",
        "observationStore.ts",
      ),
      "utf8",
    );

  const gapRepairSource =
    await readN162h5File(
      n162h5Path.join(
        uiRoot,
        "src",
        "state",
        "gapRepair.ts",
      ),
      "utf8",
    );

  const controllerSource =
    await readN162h5File(
      n162h5Path.join(
        uiRoot,
        "src",
        "state",
        "observationController.ts",
      ),
      "utf8",
    );


  const schemasUrl =
    moduleUrl(
      transpile(
        schemasSource,
      ),
    );

  const eventStreamUrl =
    moduleUrl(
      transpile(
        eventStreamSource,
      ),
    );

  const reconcilerUrl =
    moduleUrl(
      transpile(
        reconcilerSource.replace(
          '"../api/schemas"',
          JSON.stringify(
            schemasUrl,
          ),
        ),
      ),
    );

  const storeUrl =
    moduleUrl(
      transpile(
        storeSource,
      ),
    );


  const executorStubUrl =
    moduleUrl(
      [
        "export async function executeGapRepairBatch() {",
        "  throw new Error(",
        "    'default repair executor must not run in h5 injected qualification',",
        "  );",
        "}",
      ].join("\n"),
    );


  const controllerUrl =
    moduleUrl(
      transpile(
        controllerSource
          .replace(
            '"../api/eventStream"',
            JSON.stringify(
              eventStreamUrl,
            ),
          )
          .replace(
            '"./eventReconciler"',
            JSON.stringify(
              reconcilerUrl,
            ),
          )
          .replace(
            '"./gapRepairExecutor"',
            JSON.stringify(
              executorStubUrl,
            ),
          ),
      ),
    );


  const reconciler =
    await import(
      reconcilerUrl
    );

  const storeModule =
    await import(
      storeUrl
    );

  const controllerModule =
    await import(
      controllerUrl
    );


  function makeEvent(
    eventSeq,
    overrides = {},
  ) {
    return {
      schema_version:
        "1.0",

      event_seq:
        eventSeq,

      event_id:
        `evt-${eventSeq}`,

      event_type:
        "execution.started",

      occurred_at:
        "2026-09-19T02:00:00Z",

      source_class:
        "execution_supervisor",

      component:
        "execution-supervisor",

      task_id:
        "task-001",

      execution_id:
        `x${String(eventSeq).padStart(4, "0")}`,

      parent_execution_id:
        null,

      request_id:
        "req-001",

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

      payload: {
        sequence:
          eventSeq,
      },

      ...overrides,
    };
  }


  function makeFrame(
    event,
    overrides = {},
  ) {
    return Object.freeze({
      eventType:
        event.event_type,

      eventId:
        event.event_seq,

      data:
        JSON.stringify(
          event,
        ),

      ...overrides,
    });
  }


  function seedStore(
    events,
  ) {
    const store =
      storeModule
        .createObservationStore();

    store.dispatch({
      type:
        "observation/event-tail",

      observation: {
        events,

        count:
          events.length,

        limit:
          100,
      },
    });

    return store;
  }


  function createFakeTransport() {
    const sessions =
      [];

    let nextFailure =
      null;


    function failNextOpen(
      error,
    ) {
      nextFailure =
        error;
    }


    function open(
      cursor,
      handlers,
    ) {
      if (
        nextFailure !== null
      ) {
        const failure =
          nextFailure;

        nextFailure =
          null;

        throw failure;
      }


      const session = {
        cursor,

        handlers,

        closed:
          false,

        closeCount:
          0,

        connection:
          null,
      };


      const connection =
        Object.freeze({
          url:
            `/fake?after_event_seq=${cursor}`,

          close() {
            if (
              session.closed
            ) {
              return;
            }

            session.closed =
              true;

            session.closeCount +=
              1;
          },

          isClosed() {
            return session.closed;
          },
        });


      session.connection =
        connection;

      sessions.push(
        session,
      );

      return connection;
    }


    return {
      sessions,
      open,
      failNextOpen,
    };
  }


  function makePlan(
    cursor,
    liveObservedEventSeq,
  ) {
    const missingThroughEventSeq =
      liveObservedEventSeq - 1;

    const missingCount =
      missingThroughEventSeq
      - cursor;

    const requestLimit =
      Math.min(
        missingCount,
        100,
      );

    return {
      cursor,

      observedEventSeq:
        liveObservedEventSeq,

      missingFromEventSeq:
        cursor + 1,

      missingThroughEventSeq,

      requestAfterEventSeq:
        cursor,

      requestLimit,

      batchThroughEventSeq:
        cursor + requestLimit,
    };
  }


  function sequenceRange(
    first,
    last,
  ) {
    return Array.from(
      {
        length:
          last - first + 1,
      },
      (
        _,
        index,
      ) => (
        first + index
      ),
    );
  }


  function makeBatchComplete(
    cursor,
    liveObservedEventSeq,
  ) {
    const plan =
      makePlan(
        cursor,
        liveObservedEventSeq,
      );

    return {
      outcome:
        "evaluated",

      plan,

      evaluation: {
        kind:
          "batch_complete",

        evidence:
          sequenceRange(
            cursor + 1,
            plan.batchThroughEventSeq,
          ).map(
            (
              eventSeq,
            ) => (
              makeEvent(
                eventSeq,
              )
            ),
          ),

        contiguousThroughEventSeq:
          plan.batchThroughEventSeq,

        targetMissingThroughEventSeq:
          plan.missingThroughEventSeq,

        liveObservedEventSeq,
      },
    };
  }


  function failedRepair(
    cursor,
    liveObservedEventSeq,
  ) {
    return {
      outcome:
        "failed",

      plan:
        makePlan(
          cursor,
          liveObservedEventSeq,
        ),

      reason:
        "event_page_read_failed",
    };
  }


  function createController(
    store,
    transport,
    repairExecutor =
      async (
        cursor,
        liveObservedEventSeq,
      ) => (
        makeBatchComplete(
          cursor,
          liveObservedEventSeq,
        )
      ),
  ) {
    return controllerModule
      .createObservationController(
        store,
        {
          openEventStream:
            transport.open,

          reconcileEventFrame:
            reconciler
              .reconcileEventFrame,

          executeGapRepairBatch:
            repairExecutor,

          reconcileValidatedEvent:
            reconciler
              .reconcileValidatedEvent,
        },
      );
  }


  async function waitUntil(
    predicate,
    message,
    turns = 300,
  ) {
    for (
      let turn = 0;
      turn < turns;
      turn += 1
    ) {
      if (
        predicate()
      ) {
        return;
      }

      await Promise.resolve();
    }

    n162h5Assert.fail(
      message,
    );
  }


  // ----------------------------------------------------------
  // continue() is explicit and disconnected-only.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      createController(
        store,
        transport,
      );


    n162h5Assert.equal(
      typeof controller.continue,
      "function",
    );


    await n162h5Assert.rejects(
      controller.continue(),
      TypeError,
      "idle controller must not continue",
    );


    controller.start();


    await n162h5Assert.rejects(
      controller.continue(),
      TypeError,
      "streaming controller must not continue",
    );


    transport
      .sessions[0]
      .handlers
      .onProtocolError(
        "invalid_event_id",
      );


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );


    await n162h5Assert.rejects(
      controller.continue(),
      TypeError,
      "degraded controller must not continue",
    );


    controller.stop();


    await n162h5Assert.rejects(
      controller.continue(),
      TypeError,
      "stopped controller must not continue",
    );
  }


  // ----------------------------------------------------------
  // Clean disconnect -> explicit next generation.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      createController(
        store,
        transport,
      );


    controller.start();


    const generation1 =
      transport.sessions[0];


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
    );


    generation1
      .handlers
      .onDisconnect();


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
      "disconnect alone must not reconnect automatically",
    );


    await Promise.resolve();
    await Promise.resolve();


    n162h5Assert.equal(
      transport.sessions.length,
      1,
      "microtask turns must not cause automatic reconnect",
    );


    await controller.continue();


    n162h5Assert.equal(
      transport.sessions.length,
      2,
    );

    n162h5Assert.equal(
      transport.sessions[1]
        .cursor,
      42,
      "new generation must open from verified store cursor",
    );

    n162h5Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "streaming",

        sessionGeneration:
          2,

        retainedGapEventSeq:
          null,
      },
    );


    /*
     * Generation-1 callbacks remain callable in the fake
     * transport but must be inert while generation 2 streams.
     */
    generation1
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            43,
          ),
        ),
      );

    generation1
      .handlers
      .onDisconnect();

    generation1
      .handlers
      .onProtocolError(
        "invalid_event_id",
      );


    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
      "stale generation must not mutate cursor",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "streaming",
      "stale generation must not terminate current stream",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      2,
    );


    transport
      .sessions[1]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            43,
          ),
        ),
      );


    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      43,
    );


    transport
      .sessions[1]
      .handlers
      .onDisconnect();


    await controller.continue();


    n162h5Assert.equal(
      transport.sessions.length,
      3,
    );

    n162h5Assert.equal(
      transport.sessions[2]
        .cursor,
      43,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      3,
      "each new SSE construction gets a new generation",
    );
  }


  // ----------------------------------------------------------
  // Successful ordinary gap repair remains explicit:
  // no reconnect until continue() is invoked.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      createController(
        store,
        transport,
      );


    controller.start();


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        !== "repairing"
      ),
      "successful gap repair did not settle",
    );


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      45,
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
      "successful repair itself must not reopen SSE",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
      "repair completion must not increment generation",
    );


    await controller.continue();


    n162h5Assert.equal(
      transport.sessions.length,
      2,
    );

    n162h5Assert.equal(
      transport.sessions[1]
        .cursor,
      45,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      2,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "streaming",
    );
  }


  // ----------------------------------------------------------
  // Repair-read failure:
  //
  // generation 1 remains current during explicit repair resume.
  // Only successful reconstruction creates generation 2.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const repairCalls =
      [];

    let attempt =
      0;


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
          signal,
        ) => {
          attempt +=
            1;

          repairCalls.push({
            attempt,
            cursor,
            liveObservedEventSeq,
            signal,
          });


          if (
            attempt === 1
          ) {
            return failedRepair(
              cursor,
              liveObservedEventSeq,
            );
          }


          return makeBatchComplete(
            cursor,
            liveObservedEventSeq,
          );
        },
      );


    controller.start();


    const generation1 =
      transport.sessions[0];


    generation1
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        === "disconnected"
      ),
      "initial failed repair did not reach disconnected",
    );


    n162h5Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "disconnected",

        sessionGeneration:
          1,

        retainedGapEventSeq:
          45,
      },
    );

    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
    );


    const continuation =
      controller.continue();


    /*
     * continue() enters repair synchronously before its first
     * asynchronous suspension. Generation remains 1 because no
     * new stream exists yet.
     */
    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "repairing",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
    );


    await continuation;


    n162h5Assert.deepEqual(
      repairCalls.map(
        (
          call,
        ) => (
          call.cursor
        ),
      ),
      [
        42,
        42,
      ],
      "resumed repair must restart from verified store cursor",
    );

    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      45,
    );

    n162h5Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "streaming",

        sessionGeneration:
          2,

        retainedGapEventSeq:
          null,
      },
    );

    n162h5Assert.equal(
      transport.sessions.length,
      2,
    );

    n162h5Assert.equal(
      transport.sessions[1]
        .cursor,
      45,
      "new stream must start after fully repaired verified cursor",
    );


    /*
     * Stale generation-1 callbacks remain inert after resumed
     * repair has created generation 2.
     */
    generation1
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            46,
          ),
        ),
      );

    generation1
      .handlers
      .onDisconnect();

    generation1
      .handlers
      .onProtocolError(
        "invalid_event_id",
      );


    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      45,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "streaming",
    );


    transport
      .sessions[1]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            46,
          ),
        ),
      );


    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      46,
    );
  }


  // ----------------------------------------------------------
  // Repeated repair-read failure:
  // remain disconnected with retained gap; do not reopen.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    let calls =
      0;


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
        ) => {
          calls +=
            1;

          return failedRepair(
            cursor,
            liveObservedEventSeq,
          );
        },
      );


    controller.start();


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        === "disconnected"
      ),
      "first repair failure did not settle",
    );


    await controller.continue();


    n162h5Assert.equal(
      calls,
      2,
    );

    n162h5Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "disconnected",

        sessionGeneration:
          1,

        retainedGapEventSeq:
          45,
      },
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
      "unresolved repair must not create another SSE stream",
    );

    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Integrity failure during resumed repair:
  // degraded and no replacement stream.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    let attempt =
      0;


    const controller =
      createController(
        store,
        transport,
        async (
          cursor,
          liveObservedEventSeq,
        ) => {
          attempt +=
            1;


          if (
            attempt === 1
          ) {
            return failedRepair(
              cursor,
              liveObservedEventSeq,
            );
          }


          const plan =
            makePlan(
              cursor,
              liveObservedEventSeq,
            );


          return {
            outcome:
              "evaluated",

            plan,

            evaluation: {
              kind:
                "incomplete",

              reason:
                "incomplete_page",

              evidence: [
                makeEvent(
                  43,
                ),
              ],

              contiguousThroughEventSeq:
                43,

              expectedEventSeq:
                44,

              observedEventSeq:
                null,

              targetMissingThroughEventSeq:
                44,

              liveObservedEventSeq,
            },
          };
        },
      );


    controller.start();


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        === "disconnected"
      ),
      "initial repair failure did not settle",
    );


    await controller.continue();


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "degraded",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      45,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
    );

    n162h5Assert.equal(
      store
        .getSnapshot()
        .derived
        .currentEventCursor,
      42,
    );
  }


  // ----------------------------------------------------------
  // Stop during explicitly resumed repair:
  // abort work and suppress replacement stream.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    let attempt =
      0;

    let resolveSecond =
      null;

    let secondSignal =
      null;


    const controller =
      createController(
        store,
        transport,
        (
          cursor,
          liveObservedEventSeq,
          signal,
        ) => {
          attempt +=
            1;


          if (
            attempt === 1
          ) {
            return Promise.resolve(
              failedRepair(
                cursor,
                liveObservedEventSeq,
              ),
            );
          }


          secondSignal =
            signal;


          return new Promise(
            (
              resolve,
            ) => {
              resolveSecond =
                () => {
                  resolve({
                    outcome:
                      "aborted",

                    plan:
                      makePlan(
                        cursor,
                        liveObservedEventSeq,
                      ),
                  });
                };
            },
          );
        },
      );


    controller.start();


    transport
      .sessions[0]
      .handlers
      .onFrame(
        makeFrame(
          makeEvent(
            45,
          ),
        ),
      );


    await waitUntil(
      () => (
        controller
          .getSnapshot()
          .state
        === "disconnected"
      ),
      "initial read failure did not settle",
    );


    const continuation =
      controller.continue();


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "repairing",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
    );

    n162h5Assert.notEqual(
      secondSignal,
      null,
    );

    n162h5Assert.equal(
      secondSignal.aborted,
      false,
    );


    await n162h5Assert.rejects(
      controller.continue(),
      TypeError,
      "repairing controller must reject another continue",
    );


    controller.stop();


    n162h5Assert.equal(
      secondSignal.aborted,
      true,
    );


    resolveSecond();


    await continuation;


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "stopped",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .retainedGapEventSeq,
      null,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
      "stopped resumed repair must never reopen SSE",
    );
  }


  // ----------------------------------------------------------
  // Clean continuation transport construction failure:
  // Promise rejects, state remains disconnected, failed attempt
  // consumes one generation just like initial start failure.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      createController(
        store,
        transport,
      );


    controller.start();


    transport
      .sessions[0]
      .handlers
      .onDisconnect();


    const failure =
      new Error(
        "qualification continuation open failure",
      );


    transport.failNextOpen(
      failure,
    );


    await n162h5Assert.rejects(
      controller.continue(),
      (
        error,
      ) => (
        error === failure
      ),
    );


    n162h5Assert.deepEqual(
      controller.getSnapshot(),
      {
        state:
          "disconnected",

        sessionGeneration:
          2,

        retainedGapEventSeq:
          null,
      },
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
      "failed construction must not publish a fake live session",
    );


    /*
     * A later explicit attempt is permitted and gets generation 3.
     */
    await controller.continue();


    n162h5Assert.equal(
      transport.sessions.length,
      2,
    );

    n162h5Assert.equal(
      transport.sessions[1]
        .cursor,
      42,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      3,
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "streaming",
    );
  }


  // ----------------------------------------------------------
  // Baseline removal while disconnected:
  // continue fails before stream construction or generation bump.
  // ----------------------------------------------------------

  {
    const store =
      seedStore([
        makeEvent(
          42,
        ),
      ]);

    const transport =
      createFakeTransport();

    const controller =
      createController(
        store,
        transport,
      );


    controller.start();


    transport
      .sessions[0]
      .handlers
      .onDisconnect();


    store.dispatch({
      type:
        "observation/reset",
    });


    await n162h5Assert.rejects(
      controller.continue(),
      TypeError,
    );


    n162h5Assert.equal(
      controller
        .getSnapshot()
        .state,
      "disconnected",
    );

    n162h5Assert.equal(
      controller
        .getSnapshot()
        .sessionGeneration,
      1,
      "missing baseline must fail before generation increment",
    );

    n162h5Assert.equal(
      transport.sessions.length,
      1,
    );
  }


  // ----------------------------------------------------------
  // Hard authority boundaries.
  //
  // These intentionally check ownership rather than incidental
  // prose or formatting.
  // ----------------------------------------------------------

  n162h5Assert.equal(
    (
      controllerSource.match(
        /\.openEventStream\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "initial and later generations must share one stream-construction authority",
  );


  n162h5Assert.equal(
    (
      controllerSource.match(
        /\.dispatch\s*\(/g,
      )
      ?? []
    ).length,
    1,
    "continuation must not create another store mutation authority",
  );


  for (const forbidden of [
    "readEventPage",
    "planGapRepair",
    "evaluateGapRepairPage",
    "next_after_event_seq",
    "fetch(",
    "WebSocket(",
    "XMLHttpRequest",
    "setTimeout(",
    "setInterval(",
    "Date.now(",
    "performance.now(",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162h5Assert.equal(
      controllerSource.includes(
        forbidden,
      ),
      false,
      `h5 controller gained forbidden authority ${forbidden}`,
    );
  }


  n162h5Assert.equal(
    gapRepairSource.includes(
      "GAP_REPAIR_BATCH_LIMIT",
    ),
    true,
    "qualified repair bound must remain available",
  );


  console.log(
    "PASS: N16.2h5 exposes explicit continue() only from disconnected state",
  );

  console.log(
    "PASS: N16.2h5 clean disconnect continuation opens from verified store cursor",
  );

  console.log(
    "PASS: N16.2h5 creates a new generation only when constructing a new SSE session",
  );

  console.log(
    "PASS: N16.2h5 stale callbacks from older generations are inert while newer generation streams",
  );

  console.log(
    "PASS: N16.2h5 ordinary successful repair remains disconnected until explicit continuation",
  );

  console.log(
    "PASS: N16.2h5 unresolved repair is resumed before any replacement stream is opened",
  );

  console.log(
    "PASS: N16.2h5 repeated repair-read failure remains disconnected with retained gap identity",
  );

  console.log(
    "PASS: N16.2h5 resumed repair integrity failure becomes degraded without reopening SSE",
  );

  console.log(
    "PASS: N16.2h5 stop aborts resumed repair and prevents replacement stream creation",
  );

  console.log(
    "PASS: N16.2h5 stream-construction failure remains observable and disconnected",
  );

  console.log(
    "PASS: N16.2h5 missing validated baseline blocks continuation before generation increment",
  );

  console.log(
    "PASS: N16.2h5 introduces no timer-driven retry, automatic reconnect, freshness, runtime wiring, or React authority",
  );
}


// ============================================================
// N16.2i1 DETERMINISTIC OBSERVATION FRESHNESS MODEL QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162i1File,
  } = await import(
    "node:fs/promises"
  );

  const n162i1Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162i1FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162i1Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162i1TsModule =
    await import(
      "typescript"
    );

  const n162i1Ts =
    n162i1TsModule.default
    ?? n162i1TsModule;


  const scriptDirectory =
    n162i1Path.dirname(
      n162i1FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162i1Path.dirname(
      scriptDirectory,
    );


  const freshnessSource =
    await readN162i1File(
      n162i1Path.join(
        uiRoot,
        "src",
        "state",
        "observationFreshness.ts",
      ),
      "utf8",
    );


  const transpiled =
    n162i1Ts
      .transpileModule(
        freshnessSource,
        {
          compilerOptions: {
            target:
              n162i1Ts
                .ScriptTarget
                .ES2022,

            module:
              n162i1Ts
                .ModuleKind
                .ES2022,
          },
        },
      )
      .outputText;


  const freshnessUrl =
    (
      "data:text/javascript;base64,"
      + Buffer.from(
          transpiled,
          "utf8",
        ).toString(
          "base64",
        )
    );


  const freshness =
    await import(
      freshnessUrl
    );


  function makeClock(
    initial,
  ) {
    let now =
      initial;

    return {
      read:
        () => now,

      set(
        value,
      ) {
        now =
          value;
      },
    };
  }


  const policy = {
    healthMaxAgeMs:
      1000,

    tasksMaxAgeMs:
      2000,

    eventTailMaxAgeMs:
      3000,
  };


  // ----------------------------------------------------------
  // Unobserved is distinct from stale.
  // ----------------------------------------------------------

  {
    const clock =
      makeClock(
        100,
      );

    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          clock.read,
        );


    n162i1Assert.deepEqual(
      tracker.getSnapshot(),
      {
        health: {
          state:
            "unobserved",

          lastObservedAtMs:
            null,

          ageMs:
            null,

          maxAgeMs:
            1000,
        },

        tasks: {
          state:
            "unobserved",

          lastObservedAtMs:
            null,

          ageMs:
            null,

          maxAgeMs:
            2000,
        },

        eventTail: {
          state:
            "unobserved",

          lastObservedAtMs:
            null,

          ageMs:
            null,

          maxAgeMs:
            3000,
        },
      },
    );
  }


  // ----------------------------------------------------------
  // Independent source receipt times.
  // ----------------------------------------------------------

  {
    const clock =
      makeClock(
        100,
      );

    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          clock.read,
        );


    tracker.markObserved(
      "health",
    );


    clock.set(
      200,
    );

    tracker.markObserved(
      "tasks",
    );


    clock.set(
      300,
    );

    tracker.markObserved(
      "eventTail",
    );


    clock.set(
      1100,
    );


    const atBoundary =
      tracker.getSnapshot();


    n162i1Assert.deepEqual(
      atBoundary,
      {
        health: {
          state:
            "fresh",

          lastObservedAtMs:
            100,

          ageMs:
            1000,

          maxAgeMs:
            1000,
        },

        tasks: {
          state:
            "fresh",

          lastObservedAtMs:
            200,

          ageMs:
            900,

          maxAgeMs:
            2000,
        },

        eventTail: {
          state:
            "fresh",

          lastObservedAtMs:
            300,

          ageMs:
            800,

          maxAgeMs:
            3000,
        },
      },
      "exact max-age boundary remains fresh",
    );


    clock.set(
      1101,
    );


    const afterBoundary =
      tracker.getSnapshot();


    n162i1Assert.equal(
      afterBoundary
        .health
        .state,
      "stale",
    );

    n162i1Assert.equal(
      afterBoundary
        .health
        .ageMs,
      1001,
    );

    n162i1Assert.equal(
      afterBoundary
        .tasks
        .state,
      "fresh",
    );

    n162i1Assert.equal(
      afterBoundary
        .eventTail
        .state,
      "fresh",
    );


    /*
     * Refreshing one source must not refresh unrelated sources.
     */
    tracker.markObserved(
      "health",
    );


    const refreshed =
      tracker.getSnapshot();


    n162i1Assert.equal(
      refreshed
        .health
        .ageMs,
      0,
    );

    n162i1Assert.equal(
      refreshed
        .tasks
        .lastObservedAtMs,
      200,
    );

    n162i1Assert.equal(
      refreshed
        .eventTail
        .lastObservedAtMs,
      300,
    );
  }


  // ----------------------------------------------------------
  // Source-specific thresholds age independently.
  // ----------------------------------------------------------

  {
    const clock =
      makeClock(
        0,
      );

    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          clock.read,
        );


    tracker.markObserved(
      "health",
    );

    tracker.markObserved(
      "tasks",
    );

    tracker.markObserved(
      "eventTail",
    );


    clock.set(
      2001,
    );


    const snapshot =
      tracker.getSnapshot();


    n162i1Assert.equal(
      snapshot
        .health
        .state,
      "stale",
    );

    n162i1Assert.equal(
      snapshot
        .tasks
        .state,
      "stale",
    );

    n162i1Assert.equal(
      snapshot
        .eventTail
        .state,
      "fresh",
    );
  }


  // ----------------------------------------------------------
  // Reset returns sources to unobserved, not stale.
  // ----------------------------------------------------------

  {
    const clock =
      makeClock(
        500,
      );

    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          clock.read,
        );


    tracker.markObserved(
      "health",
    );

    tracker.markObserved(
      "tasks",
    );

    tracker.markObserved(
      "eventTail",
    );


    tracker.reset();


    const reset =
      tracker.getSnapshot();


    for (
      const source
      of [
        "health",
        "tasks",
        "eventTail",
      ]
    ) {
      n162i1Assert.equal(
        reset[source]
          .state,
        "unobserved",
      );

      n162i1Assert.equal(
        reset[source]
          .lastObservedAtMs,
        null,
      );

      n162i1Assert.equal(
        reset[source]
          .ageMs,
        null,
      );
    }
  }


  // ----------------------------------------------------------
  // Clock regression is rejected.
  // ----------------------------------------------------------

  {
    const clock =
      makeClock(
        1000,
      );

    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          clock.read,
        );


    tracker.markObserved(
      "health",
    );


    clock.set(
      1500,
    );

    tracker.getSnapshot();


    clock.set(
      1499,
    );


    n162i1Assert.throws(
      () => (
        tracker.getSnapshot()
      ),
      RangeError,
      "freshness clock must be monotonic",
    );
  }


  // ----------------------------------------------------------
  // Invalid clock values fail closed.
  // ----------------------------------------------------------

  for (
    const invalid
    of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]
  ) {
    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          () => invalid,
        );


    n162i1Assert.throws(
      () => (
        tracker.markObserved(
          "health",
        )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Invalid explicit policy is rejected.
  // ----------------------------------------------------------

  for (
    const invalid
    of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]
  ) {
    n162i1Assert.throws(
      () => (
        freshness
          .createObservationFreshnessTracker(
            {
              ...policy,

              tasksMaxAgeMs:
                invalid,
            },
            () => 0,
          )
      ),
      TypeError,
    );
  }


  // ----------------------------------------------------------
  // Runtime-invalid source cannot manufacture freshness.
  // ----------------------------------------------------------

  {
    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          () => 0,
        );


    n162i1Assert.throws(
      () => (
        tracker.markObserved(
          "invalid-source",
        )
      ),
      TypeError,
    );


    n162i1Assert.equal(
      tracker
        .getSnapshot()
        .health
        .state,
      "unobserved",
    );
  }


  // ----------------------------------------------------------
  // Published data is immutable.
  // ----------------------------------------------------------

  {
    const tracker =
      freshness
        .createObservationFreshnessTracker(
          policy,
          () => 0,
        );


    tracker.markObserved(
      "health",
    );


    const snapshot =
      tracker.getSnapshot();


    n162i1Assert.equal(
      Object.isFrozen(
        tracker,
      ),
      true,
    );

    n162i1Assert.equal(
      Object.isFrozen(
        snapshot,
      ),
      true,
    );

    n162i1Assert.equal(
      Object.isFrozen(
        snapshot.health,
      ),
      true,
    );

    n162i1Assert.equal(
      Object.isFrozen(
        snapshot.tasks,
      ),
      true,
    );

    n162i1Assert.equal(
      Object.isFrozen(
        snapshot.eventTail,
      ),
      true,
    );
  }


  // ----------------------------------------------------------
  // Responsibility boundary.
  //
  // Freshness is a deterministic browser-local interpretation
  // of explicitly supplied receipt times and policy.
  // ----------------------------------------------------------

  for (const forbidden of [
    "Date.now(",
    "performance.now(",
    "setTimeout(",
    "setInterval(",
    "fetch(",
    "EventSource(",
    "WebSocket(",
    "XMLHttpRequest",
    "createObservationStore",
    "createObservationController",
    "observationRuntime",
    "occurred_at",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162i1Assert.equal(
      freshnessSource.includes(
        forbidden,
      ),
      false,
      `freshness model gained forbidden authority ${forbidden}`,
    );
  }


  n162i1Assert.equal(
    freshnessSource
      .includes(
        '"unobserved"',
      ),
    true,
  );

  n162i1Assert.equal(
    freshnessSource
      .includes(
        '"fresh"',
      ),
    true,
  );

  n162i1Assert.equal(
    freshnessSource
      .includes(
        '"stale"',
      ),
    true,
  );


  console.log(
    "PASS: N16.2i1 distinguishes unobserved, fresh, and stale observations",
  );

  console.log(
    "PASS: N16.2i1 freshness is based on browser receipt time rather than event occurred_at",
  );

  console.log(
    "PASS: N16.2i1 exact max-age boundary remains fresh and max-age plus one is stale",
  );

  console.log(
    "PASS: N16.2i1 tracks health, tasks, and bootstrap event-tail independently",
  );

  console.log(
    "PASS: N16.2i1 requires caller-supplied source-specific freshness policy",
  );

  console.log(
    "PASS: N16.2i1 requires an injected monotonic clock",
  );

  console.log(
    "PASS: N16.2i1 rejects clock regression and invalid clock values",
  );

  console.log(
    "PASS: N16.2i1 reset returns receipt state to unobserved",
  );

  console.log(
    "PASS: N16.2i1 does not infer SSE liveness, trusted execution health, or event-stream completeness",
  );

  console.log(
    "PASS: N16.2i1 introduces no timer, network, store, controller, runtime, or React authority",
  );
}


// ============================================================
// N16.2i2 SUCCESSFUL-OBSERVATION RECEIPT INTEGRATION QUALIFICATION
// ============================================================

{
  const {
    readFile:
      readN162i2File,
  } = await import(
    "node:fs/promises"
  );

  const n162i2Path =
    await import(
      "node:path"
    );

  const {
    fileURLToPath:
      n162i2FileURLToPath,
  } = await import(
    "node:url"
  );

  const n162i2Assert = (
    await import(
      "node:assert/strict"
    )
  ).default;

  const n162i2TsModule =
    await import(
      "typescript"
    );

  const n162i2Ts =
    n162i2TsModule.default
    ?? n162i2TsModule;


  const scriptDirectory =
    n162i2Path.dirname(
      n162i2FileURLToPath(
        import.meta.url,
      ),
    );

  const uiRoot =
    n162i2Path.dirname(
      scriptDirectory,
    );


  function transpile(
    source,
  ) {
    return n162i2Ts
      .transpileModule(
        source,
        {
          compilerOptions: {
            target:
              n162i2Ts
                .ScriptTarget
                .ES2022,

            module:
              n162i2Ts
                .ModuleKind
                .ES2022,
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


  const coordinatorSource =
    await readN162i2File(
      n162i2Path.join(
        uiRoot,
        "src",
        "state",
        "bootstrapCoordinator.ts",
      ),
      "utf8",
    );

  const runtimeSource =
    await readN162i2File(
      n162i2Path.join(
        uiRoot,
        "src",
        "state",
        "observationRuntime.ts",
      ),
      "utf8",
    );


  const coordinatorUrl =
    moduleUrl(
      transpile(
        coordinatorSource,
      ),
    );


  const coordinator =
    await import(
      coordinatorUrl
    );


  const healthObservation = {
    status:
      "ok",

    service:
      "trusted-hybrid-ai-orchestrator-control-plane",

    api_version:
      "1.0",

    authority:
      "read_only",
  };


  const taskObservation = {
    tasks:
      [],

    limit:
      100,

    truncated:
      false,
  };


  const eventObservation = {
    events:
      [],

    count:
      0,

    limit:
      100,
  };


  function makeReaders(
    overrides = {},
  ) {
    return {
      async readHealth() {
        return healthObservation;
      },

      async readTasks() {
        return taskObservation;
      },

      async readEventTail() {
        return eventObservation;
      },

      ...overrides,
    };
  }


  function makeRecordingPair() {
    const trace =
      [];

    return {
      trace,

      store: {
        getSnapshot() {
          throw new Error(
            "getSnapshot not required by i2 coordinator qualification",
          );
        },

        dispatch(
          action,
        ) {
          trace.push(
            `dispatch:${action.type}`,
          );
        },

        subscribe() {
          throw new Error(
            "subscribe not required by i2 coordinator qualification",
          );
        },
      },

      recorder: {
        markObserved(
          source,
        ) {
          trace.push(
            `mark:${source}`,
          );
        },
      },
    };
  }


  // ----------------------------------------------------------
  // Complete bootstrap:
  // receipt follows successful store transition for each source.
  // ----------------------------------------------------------

  {
    const {
      trace,
      store,
      recorder,
    } = makeRecordingPair();


    const result =
      await coordinator
        .bootstrapObservations(
          store,
          makeReaders(),
          undefined,
          recorder,
        );


    n162i2Assert.deepEqual(
      trace,
      [
        "dispatch:observation/health",
        "mark:health",

        "dispatch:observation/tasks",
        "mark:tasks",

        "dispatch:observation/event-tail",
        "mark:eventTail",
      ],
      "receipt must follow accepted store transition",
    );


    n162i2Assert.deepEqual(
      result.sources,
      {
        health:
          "observed",

        tasks:
          "observed",

        eventTail:
          "observed",
      },
    );
  }


  // ----------------------------------------------------------
  // Read failure:
  // failed source is not marked; independent successes are.
  // ----------------------------------------------------------

  {
    const {
      trace,
      store,
      recorder,
    } = makeRecordingPair();


    const result =
      await coordinator
        .bootstrapObservations(
          store,
          makeReaders({
            async readTasks() {
              throw new Error(
                "qualification task read failure",
              );
            },
          }),
          undefined,
          recorder,
        );


    n162i2Assert.deepEqual(
      trace,
      [
        "dispatch:observation/health",
        "mark:health",

        "dispatch:observation/event-tail",
        "mark:eventTail",
      ],
    );


    n162i2Assert.deepEqual(
      result.sources,
      {
        health:
          "observed",

        tasks:
          "failed",

        eventTail:
          "observed",
      },
    );
  }


  // ----------------------------------------------------------
  // Pre-abort:
  // no read, dispatch, or receipt.
  // ----------------------------------------------------------

  {
    const {
      trace,
      store,
      recorder,
    } = makeRecordingPair();

    const controller =
      new AbortController();

    controller.abort();


    const result =
      await coordinator
        .bootstrapObservations(
          store,
          makeReaders(),
          controller.signal,
          recorder,
        );


    n162i2Assert.deepEqual(
      trace,
      [],
    );

    n162i2Assert.equal(
      result.outcome,
      "aborted",
    );
  }


  // ----------------------------------------------------------
  // Abort after reader resolves:
  // a result rejected by cancellation cannot manufacture receipt.
  // ----------------------------------------------------------

  {
    const {
      trace,
      store,
      recorder,
    } = makeRecordingPair();

    const controller =
      new AbortController();


    const result =
      await coordinator
        .bootstrapObservations(
          store,
          makeReaders({
            async readHealth() {
              controller.abort();

              return healthObservation;
            },
          }),
          controller.signal,
          recorder,
        );


    n162i2Assert.deepEqual(
      trace,
      [],
    );

    n162i2Assert.equal(
      result.sources.health,
      "aborted",
    );
  }


  // ----------------------------------------------------------
  // Store failure:
  // freshness must not advance if the observation did not cross
  // the ObservationStore boundary.
  // ----------------------------------------------------------

  {
    const marks =
      [];


    await n162i2Assert.rejects(
      () => (
        coordinator
          .bootstrapObservations(
            {
              getSnapshot() {
                throw new Error(
                  "unused",
                );
              },

              dispatch() {
                throw new Error(
                  "qualification store failure",
                );
              },

              subscribe() {
                throw new Error(
                  "unused",
                );
              },
            },
            makeReaders(),
            undefined,
            {
              markObserved(
                source,
              ) {
                marks.push(
                  source,
                );
              },
            },
          )
      ),
      /qualification store failure/,
    );


    n162i2Assert.deepEqual(
      marks,
      [],
      "store rejection must prevent freshness receipt",
    );
  }


  // ----------------------------------------------------------
  // Receipt-metadata fault:
  // store transition already occurred; metadata fault propagates
  // rather than being misclassified as a read failure.
  // ----------------------------------------------------------

  {
    const trace =
      [];

    const calls =
      [];


    await n162i2Assert.rejects(
      () => (
        coordinator
          .bootstrapObservations(
            {
              getSnapshot() {
                throw new Error(
                  "unused",
                );
              },

              dispatch(
                action,
              ) {
                trace.push(
                  `dispatch:${action.type}`,
                );
              },

              subscribe() {
                throw new Error(
                  "unused",
                );
              },
            },
            {
              async readHealth() {
                calls.push(
                  "health",
                );

                return healthObservation;
              },

              async readTasks() {
                calls.push(
                  "tasks",
                );

                return taskObservation;
              },

              async readEventTail() {
                calls.push(
                  "eventTail",
                );

                return eventObservation;
              },
            },
            undefined,
            {
              markObserved(
                source,
              ) {
                trace.push(
                  `mark:${source}`,
                );

                throw new Error(
                  "qualification receipt failure",
                );
              },
            },
          )
      ),
      /qualification receipt failure/,
    );


    n162i2Assert.deepEqual(
      calls,
      [
        "health",
      ],
      "receipt failure must propagate immediately",
    );


    n162i2Assert.deepEqual(
      trace,
      [
        "dispatch:observation/health",
        "mark:health",
      ],
      "receipt failure occurs only after accepted observation",
    );
  }


  // ----------------------------------------------------------
  // Historical no-recorder path remains valid.
  // ----------------------------------------------------------

  {
    const actions =
      [];


    const result =
      await coordinator
        .bootstrapObservations(
          {
            getSnapshot() {
              throw new Error(
                "unused",
              );
            },

            dispatch(
              action,
            ) {
              actions.push(
                action.type,
              );
            },

            subscribe() {
              throw new Error(
                "unused",
              );
            },
          },
          makeReaders(),
        );


    n162i2Assert.deepEqual(
      actions,
      [
        "observation/health",
        "observation/tasks",
        "observation/event-tail",
      ],
    );

    n162i2Assert.equal(
      result.outcome,
      "complete",
    );
  }


  // ----------------------------------------------------------
  // Runtime composition qualification.
  //
  // Use module stubs so we can execute the actual runtime module
  // without network or application dependencies.
  // ----------------------------------------------------------

  const httpStubUrl =
    moduleUrl(
      [
        "export async function readServiceHealth() {",
        "  throw new Error('unused default health reader');",
        "}",
        "export async function readTaskStatusProjections() {",
        "  throw new Error('unused default task reader');",
        "}",
        "export async function readEventTail() {",
        "  throw new Error('unused default event reader');",
        "}",
      ].join(
        "\n",
      ),
    );


  const coordinatorStubUrl =
    moduleUrl(
      [
        "export const bootstrapCalls = [];",
        "",
        "export async function bootstrapObservations(",
        "  store,",
        "  readers,",
        "  signal,",
        "  receiptRecorder,",
        ") {",
        "  bootstrapCalls.push({",
        "    store,",
        "    readers,",
        "    signal,",
        "    receiptRecorder,",
        "  });",
        "",
        "  return {",
        "    outcome: 'complete',",
        "    sources: {",
        "      health: 'observed',",
        "      tasks: 'observed',",
        "      eventTail: 'observed',",
        "    },",
        "  };",
        "}",
      ].join(
        "\n",
      ),
    );


  const storeStubUrl =
    moduleUrl(
      [
        "let nextId = 0;",
        "",
        "export function createObservationStore() {",
        "  nextId += 1;",
        "",
        "  return Object.freeze({",
        "    id: nextId,",
        "    getSnapshot() {",
        "      return {};",
        "    },",
        "    dispatch() {},",
        "    subscribe() {",
        "      return () => {};",
        "    },",
        "  });",
        "}",
      ].join(
        "\n",
      ),
    );


  const rewrittenRuntime =
    runtimeSource
      .replace(
        '"../api/httpClient"',
        JSON.stringify(
          httpStubUrl,
        ),
      )
      .replace(
        '"./bootstrapCoordinator"',
        JSON.stringify(
          coordinatorStubUrl,
        ),
      )
      .replace(
        '"./observationStore"',
        JSON.stringify(
          storeStubUrl,
        ),
      );


  const runtimeUrl =
    moduleUrl(
      transpile(
        rewrittenRuntime,
      ),
    );


  const runtimeModule =
    await import(
      runtimeUrl
    );

  const coordinatorStub =
    await import(
      coordinatorStubUrl
    );


  const customReaders = {
    async readHealth() {
      return healthObservation;
    },

    async readTasks() {
      return taskObservation;
    },

    async readEventTail() {
      return eventObservation;
    },
  };


  const freshnessTracker = {
    markObserved() {
      throw new Error(
        "runtime qualification does not invoke markObserved directly",
      );
    },

    getSnapshot() {
      return {
        health: {
          state:
            "fresh",
        },
      };
    },

    reset() {},
  };


  const runtime =
    runtimeModule
      .createObservationRuntime(
        customReaders,
        freshnessTracker,
      );


  n162i2Assert.notEqual(
    runtime.freshness,
    null,
  );


  n162i2Assert.deepEqual(
    Object.keys(
      runtime.freshness,
    ),
    [
      "getSnapshot",
    ],
    "runtime must expose freshness as read-only view",
  );


  n162i2Assert.equal(
    "markObserved"
      in runtime.freshness,
    false,
    "runtime must not publish freshness mutation authority",
  );


  n162i2Assert.equal(
    Object.isFrozen(
      runtime.freshness,
    ),
    true,
  );


  n162i2Assert.deepEqual(
    runtime
      .freshness
      .getSnapshot(),
    {
      health: {
        state:
          "fresh",
      },
    },
  );


  const signalController =
    new AbortController();


  await runtime.bootstrap(
    signalController.signal,
  );


  const latestRuntimeCall =
    coordinatorStub
      .bootstrapCalls
      .at(
        -1,
      );


  n162i2Assert.equal(
    latestRuntimeCall
      .readers,
    customReaders,
  );

  n162i2Assert.equal(
    latestRuntimeCall
      .signal,
    signalController.signal,
  );

  n162i2Assert.equal(
    latestRuntimeCall
      .receiptRecorder,
    freshnessTracker,
    "runtime must inject tracker only at bootstrap receipt boundary",
  );


  // ----------------------------------------------------------
  // No supplied tracker -> no invented freshness policy.
  // ----------------------------------------------------------

  {
    const runtimeWithoutFreshness =
      runtimeModule
        .createObservationRuntime(
          customReaders,
        );


    n162i2Assert.equal(
      runtimeWithoutFreshness
        .freshness,
      null,
    );


    await runtimeWithoutFreshness
      .bootstrap();


    const call =
      coordinatorStub
        .bootstrapCalls
        .at(
          -1,
        );


    n162i2Assert.equal(
      call.receiptRecorder,
      undefined,
    );
  }


  // Application singleton must likewise remain policy-free.
  n162i2Assert.equal(
    runtimeModule
      .observationRuntime
      .freshness,
    null,
    "application runtime must not invent freshness policy or clock",
  );


  // ----------------------------------------------------------
  // Hard authority boundaries.
  // ----------------------------------------------------------

  for (const forbidden of [
    "Date.now(",
    "performance.now(",
    "setTimeout(",
    "setInterval(",
    "fetch(",
    "EventSource(",
    "WebSocket(",
    "XMLHttpRequest",
    "useEffect(",
    "useState(",
    'from "react"',
  ]) {
    n162i2Assert.equal(
      coordinatorSource.includes(
        forbidden,
      ),
      false,
      `bootstrap coordinator gained forbidden authority ${forbidden}`,
    );

    n162i2Assert.equal(
      runtimeSource.includes(
        forbidden,
      ),
      false,
      `observation runtime gained forbidden authority ${forbidden}`,
    );
  }


  n162i2Assert.equal(
    runtimeSource.includes(
      "createObservationFreshnessTracker",
    ),
    false,
    "runtime must not construct a tracker or select freshness policy",
  );


  n162i2Assert.equal(
    runtimeSource.includes(
      "healthMaxAgeMs",
    ),
    false,
    "runtime must not contain health freshness policy",
  );

  n162i2Assert.equal(
    runtimeSource.includes(
      "tasksMaxAgeMs",
    ),
    false,
    "runtime must not contain task freshness policy",
  );

  n162i2Assert.equal(
    runtimeSource.includes(
      "eventTailMaxAgeMs",
    ),
    false,
    "runtime must not contain event-tail freshness policy",
  );


  console.log(
    "PASS: N16.2i2 records freshness only after successful ObservationStore dispatch",
  );

  console.log(
    "PASS: N16.2i2 failed reads do not refresh their source",
  );

  console.log(
    "PASS: N16.2i2 aborted reads do not refresh their source",
  );

  console.log(
    "PASS: N16.2i2 store rejection prevents freshness advancement",
  );

  console.log(
    "PASS: N16.2i2 receipt-metadata faults propagate after accepted observation",
  );

  console.log(
    "PASS: N16.2i2 historical bootstrap without a receipt recorder remains valid",
  );

  console.log(
    "PASS: N16.2i2 runtime injects caller-supplied tracker into bootstrap receipt boundary",
  );

  console.log(
    "PASS: N16.2i2 runtime exposes freshness through a read-only snapshot view",
  );

  console.log(
    "PASS: N16.2i2 application runtime selects no implicit freshness policy or clock",
  );

  console.log(
    "PASS: N16.2i2 introduces no timer, network, controller, or React authority",
  );
}

await import("./qualify-n16.3a1.mjs");

await import("./qualify-n16.3a2.mjs");

await import("./qualify-n16.3a3.mjs");

await import("./qualify-n16.3b.mjs");

await import("./qualify-n16.4.mjs");

await import("./qualify-n16.5.mjs");

await import("./qualify-n16.6.mjs");
