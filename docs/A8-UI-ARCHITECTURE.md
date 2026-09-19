# A8 — UI Architecture and Information Model

Status: Draft for architecture qualification

Baseline: A7 UI / control-plane threat model

Qualified baseline tag:

`a7-ui-threat-model-qualified`

Qualified baseline commit:

`63d940206f636dbcd866022334f4ff1097503fc6`

Research date:

`2026-09-18`

---

## 1. Purpose

This document freezes the implementation architecture for the N16 read-only
browser UI of the Trusted Hybrid AI Orchestrator.

A8 converts the security constraints defined by A7 into a concrete UI
architecture, data-flow model, presentation model, transport state machine,
component boundary, and implementation sequence.

The N16 UI is an observability and decision-support surface.

It is not an execution-authority surface.

---

## 2. Governing Architecture Principle

The browser remains untrusted.

The control plane remains non-authoritative.

The UI may:

- observe qualified task projections;
- observe qualified event-journal data;
- derive clearly labelled client-side metrics;
- visualize execution paths;
- visualize model/provider observations;
- visualize verification and human-gate state;
- visualize transport freshness and degradation.

The UI may not:

- create trusted state;
- mutate trusted state;
- infer unobserved transitions as facts;
- reinterpret timeout budgets as ETA;
- turn browser connectivity into execution-health evidence;
- silently perform retry, approval, cancellation, routing, or model-selection
  actions.

---

## 3. Research Inputs and Reusable Patterns

A8 draws on current interface patterns from:

- LangGraph Studio / LangSmith;
- n8n workflow execution views;
- LM Studio Developer / Local Server views;
- Open WebUI model and workspace views.

Patterns worth adopting:

- visual execution graph with active/observed path emphasis;
- adjacent detailed trace or event timeline;
- explicit execution-state labels;
- compact model/runtime cards;
- searchable model presentation;
- expandable detail instead of permanently dense screens;
- persistent high-level execution context while inspecting detail.

Patterns deliberately not adopted for N16:

- chat-first primary navigation;
- editable workflow canvas;
- state-editing controls;
- execution buttons;
- retry buttons;
- assistant/model mutation from the UI;
- implicit authority from clicking a graph node;
- remote telemetry or cloud analytics.

---

## 4. A8 Architecture Decisions

A8 freezes the following decisions:

1. React with TypeScript is the N16 presentation framework.
2. Vite is the development/build tool.
3. The browser consumes HTTP GET plus Server-Sent Events only.
4. No control-plane WebSocket is introduced.
5. Development uses a same-origin frontend proxy to the loopback API.
6. Production-style local serving uses one loopback origin.
7. Raw API and SSE data never flow directly into presentation components.
8. A normalization/reducer layer owns ordering, deduplication, replay, and
   sequence-gap detection.
9. Trusted observations, derived metrics, and predictions use separate data
   classes and visual semantics.
10. No ETA is shown in N16 unless a separately qualified prediction contract
    exists.
11. Event-source health and execution health remain separate.
12. Model inventory observations and model-binding observations remain separate.
13. Human-gate status is displayed but cannot be acted on.
14. Browser state remains in memory by default.
15. No remote scripts, analytics, fonts, or telemetry are required.

---

## 5. Deployment Topology

### 5.1 Development topology

```text
Browser
   |
   | http://127.0.0.1:<vite-port>
   v
Vite development server
   |
   | /api proxy
   v
FastAPI control plane
127.0.0.1:8765
   |
   v
Qualified observer seams
```

The browser sends API requests to the frontend origin.

Vite proxies `/api` requests to the control plane.

The control plane does not require permissive CORS.

Vite development HMR may use a development-only WebSocket.

That WebSocket is tooling transport only and is not an orchestrator
authority or control-plane transport.

### 5.2 Production-style local topology

```text
Browser
   |
   | one loopback origin
   v
FastAPI + compiled static UI
127.0.0.1:8765
   |
   +---- /api/v1/*
   |
   +---- static UI assets
```

The production-style UI and API share one origin.

No LAN exposure is introduced.

---

## 6. Frontend Trust Pipeline

The frontend data path is:

```text
HTTP / SSE
    |
    v
Transport adapters
    |
    v
Schema validation
    |
    v
Observation reducer
    |
    +-------------------------+
    |                         |
    v                         v
Trusted-observation store   Connectivity state
    |
    v
Derived selectors
    |
    +-------------------------+
    |                         |
    v                         v
Derived metrics            Explicit estimates
                              if later supported
    |
    v
View models
    |
    v
React presentation components
```

Presentation components must not independently interpret raw trusted-state or
raw SSE semantics.

---

## 7. Information Architecture

N16 uses one primary application shell with four persistent regions:

```text
+---------------------------------------------------------------+
| System / stream status | selected task | freshness | clock    |
+----------------+--------------------------------+-------------+
| Task navigator | Execution path                 | Runtime /   |
|                |                                | model panel |
|                |                                |             |
+----------------+--------------------------------+-------------+
| Event / evidence timeline and expandable details              |
+---------------------------------------------------------------+
```

The UI prioritizes:

1. what task is being observed;
2. where execution currently appears to be;
3. which observations support that view;
4. which model/provider binding was observed;
5. how much bounded resource has been consumed;
6. whether verification or human authority is pending;
7. whether the displayed information is current, stale, or incomplete.

---

## 8. Primary Views

### 8.1 Overview

Purpose:

- orient the operator rapidly;
- show currently observed tasks;
- show system observation status;
- surface tasks needing attention without implying authority.

### 8.2 Task / Execution Detail

Purpose:

- show one task projection;
- render its observed execution path;
- display budgets and elapsed metrics;
- show model/provider observations;
- show verification and human-gate state;
- correlate relevant trusted events.

### 8.3 Event Timeline

Purpose:

- provide chronological evidence;
- support filtering;
- expose event sequence, timestamp, type, and source;
- show sanitized payload details;
- make replay, gaps, and staleness visible.

N16 does not require a separate chat view.

---

## 9. N16.0 Read-Only Observer-Support Requirement

A8 identifies two capability gaps in the qualified N15a API.

### 9.1 Task discovery

Current API observation can retrieve a task only when its task ID is already
known.

A useful dashboard requires bounded task discovery.

N16.0 should add a qualified observer seam that returns a bounded collection
of narrow `TaskStatusProjection` objects.

The API may expose this through a read-only endpoint such as:

`GET /api/v1/tasks`

Requirements:

- observer-only;
- state-root confined;
- no task mutation;
- no provider calls;
- no journal writes;
- bounded result count;
- deterministic ordering;
- narrow projections only;
- no raw task YAML;
- no filesystem paths;
- no prompts, outputs, evidence bodies, or human notes.

### 9.2 Recent event bootstrap

The current event API pages ascending from a caller-supplied cursor.

A dashboard needs a bounded recent-state bootstrap without replaying an
unbounded journal from sequence zero.

N16.0 should add a qualified read-only tail observer such as:

`GET /api/v1/events/tail?limit=N`

Requirements:

- bounded limit;
- read-only SQLite connection;
- newest N trusted events selected;
- response returned in ascending event-sequence order for deterministic reducer
  ingestion;
- no cursor mutation;
- no journal initialization or repair;
- no fabricated events.

These extensions belong to N16 implementation support.

They do not alter the A7 authority model.

---

## 10. Client Observation Store

The normalized client store contains four domains.

### 10.1 Tasks

Key:

`task_id`

Value:

- immutable latest task projection;
- local receipt time;
- observation freshness metadata.

### 10.2 Events

Key:

`event_seq`

Value:

- canonical trusted event;
- local receipt time.

Events are deduplicated by `event_seq`.

### 10.3 Connectivity

Contains:

- current stream state;
- last transport activity;
- last trusted event sequence;
- detected gap range;
- reconnect count;
- last successful HTTP bootstrap time.

Connectivity state is derived client state.

It is not trusted orchestrator state.

### 10.4 UI state

Contains only presentation choices such as:

- selected task;
- active filters;
- expanded event rows;
- panel sizes;
- theme.

UI state must not be confused with orchestrator state.

---

## 11. SSE Client State Machine

The N16 SSE client uses these states:

```text
BOOTSTRAP
    |
    v
CONNECTING
    |
    +---- success ----------------> LIVE
    |                                |
    |                                | inactivity threshold
    |                                v
    |                              STALE
    |                                |
    |                                | activity resumes
    |                                v
    |                              LIVE
    |
    +---- transport loss ----------> RECONNECTING
                                     |
                                     +---- success ---> LIVE
                                     |
                                     +---- repeated
                                           failure ---> DISCONNECTED
```

A sequence gap adds a separate data-integrity condition:

`GAP_DETECTED`

This condition may coexist with transport states.

The UI must not represent `LIVE` as equivalent to task health.

---

## 12. Event Ingestion Rules

For an incoming trusted event with sequence `N`:

1. if `N` is already stored, treat it as replay and do not duplicate it;
2. if no prior sequence exists, accept it as bootstrap data;
3. if `N == last_seq + 1`, append normally;
4. if `N < last_seq`, retain deterministic order and treat it as replay/backfill;
5. if `N > last_seq + 1`, flag a sequence gap;
6. never manufacture events for missing sequence numbers;
7. never convert keepalives into events;
8. never convert transport failures into trusted execution events.

A detected gap must be visible to the operator.

---

## 13. Bootstrap and Reconnect Strategy

Initial load:

1. fetch service health;
2. fetch bounded task projections;
3. fetch bounded event tail;
4. normalize those observations;
5. record the greatest observed `event_seq`;
6. open SSE from that cursor.

Reconnect:

1. retain the greatest trusted sequence in memory;
2. reconnect using SSE cursor semantics;
3. deduplicate replay;
4. detect sequence gaps;
5. backfill through the existing event query when needed;
6. remain visibly degraded if the gap cannot be closed.

Browser refresh may lose in-memory client state.

The next bootstrap reconstructs the current bounded observation window.

---

## 14. Execution-Path Model

The execution-path visualization is evidence-driven.

Potential stages include:

```text
Request
  |
  v
Routing
  |
  v
Provider inventory
  |
  v
Model binding
  |
  v
Budget
  |
  v
Execution
  |
  v
Verification
  |
  v
Human authority / terminal state
```

Not every task must traverse every stage.

Each visual node has one of these presentation states:

- `OBSERVED_COMPLETE`
- `OBSERVED_ACTIVE`
- `OBSERVED_FAILED`
- `OBSERVED_TIMED_OUT`
- `AWAITING_HUMAN`
- `EXPECTED_NOT_OBSERVED`
- `UNKNOWN`

`EXPECTED_NOT_OBSERVED` is a presentation projection, not a trusted fact.

The UI must label it accordingly.

---

## 15. Execution-Path Evidence Rules

A path node becomes observed only when supported by:

- a trusted event;
- or a qualified task projection field whose semantics directly support the
  node state.

The UI must not:

- mark routing complete because execution began unless the event/projection
  contract supports that inference;
- mark a model loaded merely because it was selected;
- mark verification passed because execution completed;
- mark a human gate approved because no gate is currently displayed.

Every path-state reducer rule must be deterministic and testable.

---

## 16. Model and Provider Presentation

The runtime/model panel distinguishes:

### Provider inventory observation

Meaning:

"The provider reported this inventory at an observed point in time."

It does not mean:

"The model is currently loaded, healthy, or available."

### Model binding observation

Meaning:

"The orchestrator selected/bound this model for a specific execution context."

It does not mean:

"The model successfully executed."

### Execution observation

Meaning:

"Execution lifecycle evidence exists for this worker/execution."

The UI should display inventory timestamp/freshness whenever available.

Model cards may show:

- model identifier;
- provider;
- observed role/binding;
- last inventory observation;
- associated execution state.

No model quality ranking belongs in N16.

---

## 17. Timing and Budget Model

The UI keeps four concepts separate.

### 17.1 Elapsed wall time

Client-derived or event-derived duration since a defined observed start.

Label:

`Elapsed`

### 17.2 Trusted runtime consumed

Value reported by the task projection/accounting contract.

Label:

`Runtime used`

### 17.3 Runtime limit / timeout budget

Maximum allowed value.

Label:

`Runtime limit`

### 17.4 Estimated remaining runtime

Prediction.

Label:

`Estimated remaining`

N16 initial implementation:

`Estimated remaining: unavailable`

until a separately defined estimation method exists.

A timeout budget is not an ETA.

---

## 18. Budget Presentation

Budget indicators may visualize ratios such as:

- worker calls used / maximum;
- runtime used / maximum;
- cloud worker calls used / applicable bound.

The UI must show the underlying numbers alongside any bar or gauge.

A partially filled budget bar means consumption.

It does not mean task progress.

---

## 19. Human-Gate Presentation

Human-gate state is read-only.

Recommended visible states:

- `Pending`
- `Approved`
- `Rejected`
- `Not required`
- `Unknown`

For N16:

- no Approve button;
- no Reject button;
- no Continue button;
- no Retry button.

A pending human gate may be visually prominent because it requires operator
attention, but the UI cannot satisfy it.

---

## 20. Event Timeline

Each event row should show:

- event sequence;
- timestamp;
- source;
- event type;
- task ID when present;
- execution ID when present;
- request ID when present;
- expandable sanitized payload.

The timeline supports client-side filters for:

- task;
- execution;
- request;
- source;
- event type.

When any filter is active, that fact must be visually obvious.

Filtering changes presentation only.

It does not change trusted history.

---

## 21. Observation Freshness

The application shell always exposes freshness.

Recommended labels:

- `Live`
- `Reconnecting`
- `Stale`
- `Disconnected`
- `Gap detected`

Freshness is based on transport and last-observation timing.

It must be presented separately from:

- task running;
- task success;
- verification state;
- provider health.

---

## 22. Visual Semantics

The UI uses three explicit evidence classes.

### Observed

Represents data originating from qualified observer seams.

Recommended marker:

`Observed`

### Derived

Represents deterministic client-side calculation from observations.

Recommended marker:

`Derived`

### Estimate

Represents a prediction or heuristic.

Recommended marker:

`Estimate`

Status meaning must never depend on color alone.

Text labels and/or icons accompany color.

---

## 23. Visual Design Direction

The desired style is:

- modern;
- clean;
- calm;
- technical;
- information-dense without appearing crowded;
- suitable for long-running engineering work;
- dark and light themes supported eventually;
- desktop-first for N16 Alpha.

Avoid:

- gaming aesthetics;
- excessive neon;
- animated decorative backgrounds;
- large marketing-style hero sections;
- chat bubbles as the primary information model;
- excessive card fragmentation;
- color-only status meaning.

A graph-plus-inspector layout is preferred over a chat-first layout.

---

## 24. Typography and Assets

Default policy:

- no remotely hosted fonts;
- no third-party analytics;
- no remote icon CDN;
- no remote JavaScript.

Typography should use a bundled or system font stack.

Monospace is reserved for:

- IDs;
- event sequence;
- timestamps where appropriate;
- technical values;
- structured payloads.

Body and navigation text use a readable sans-serif.

---

## 25. Security Headers and Cache Policy

Production-style serving should target a policy equivalent to:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'none'
```

Additional headers:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

API observation responses:

```text
Cache-Control: no-store
```

SSE:

```text
Cache-Control: no-cache
```

The compiled static assets may use normal immutable caching where filenames
are content-hashed.

The application HTML should not rely on persistent caching for correctness.

Development CSP may differ where Vite HMR requires a local development
WebSocket.

That exception does not apply to the production control plane.

---

## 26. Resource-Bounding Rules

N16 assumes a local single-operator deployment.

The UI should:

- maintain one SSE connection per application tab;
- avoid parallel duplicate event streams within one tab;
- use bounded bootstrap queries;
- use bounded backfill;
- cap rendered timeline rows or virtualize them;
- avoid polling when SSE is healthy;
- avoid provider probing from the browser.

A later multi-user or LAN deployment requires a separate scaling and security
review.

---

## 27. Error and Degraded-State Presentation

Errors are classified into:

- transport unavailable;
- observer query unavailable;
- malformed/unexpected response;
- sequence gap;
- task unavailable;
- stale observation.

The UI must not display internal backend diagnostics that the API intentionally
redacts.

A degraded UI should preserve the last valid observation where safe and mark it
as stale rather than replacing it with fabricated defaults.

---

## 28. Frontend Module Boundaries

Recommended structure:

```text
ui/
  src/
    api/
      httpClient.ts
      eventStream.ts
      schemas.ts

    state/
      observationStore.ts
      eventReducer.ts
      connectivityReducer.ts

    selectors/
      taskSelectors.ts
      executionPathSelectors.ts
      timingSelectors.ts
      modelSelectors.ts
      eventSelectors.ts

    viewmodels/
      taskViewModel.ts
      executionViewModel.ts
      runtimeViewModel.ts

    components/
      shell/
      tasks/
      execution/
      runtime/
      events/
      status/

    pages/
      OverviewPage.tsx
      TaskPage.tsx

    app/
      App.tsx
      routes.tsx
```

The exact filenames may change during implementation.

The architectural boundaries may not.

---

## 29. API-to-UI Mapping

Current qualified API:

### `GET /api/v1/health`

Maps to:

- service reachability;
- API version;
- read-only authority indicator.

Must not become execution-health evidence.

### `GET /api/v1/tasks/{task_id}`

Maps to:

- selected task projection;
- budget values;
- status;
- checkpoint state;
- human-gate display.

### `GET /api/v1/events`

Maps to:

- gap backfill;
- filtered evidence retrieval;
- deterministic historical ingestion.

### `GET /api/v1/events/stream`

Maps to:

- live observation updates.

Proposed N16.0 additions:

### `GET /api/v1/tasks`

Maps to:

- bounded task navigator.

### `GET /api/v1/events/tail`

Maps to:

- bounded recent-event bootstrap.

---

## 30. React Component Responsibilities

React presentation components may:

- render view-model fields;
- emit local navigation/filter actions;
- expand/collapse details;
- render graph states;
- render status semantics.

React presentation components may not:

- parse trusted event semantics independently;
- decide whether an event is replay;
- perform sequence-gap repair;
- infer model health;
- infer trusted transitions;
- call mutation APIs;
- persist sensitive event bodies by default.

Those responsibilities remain in the defined adapter/reducer/selector layers.

---

## 31. N16 Implementation Slices

Recommended sequence:

### N16.0 — Observer support

- task-list observer seam;
- event-tail observer seam;
- GET-only API adapters;
- regression coverage;
- loopback qualification.

### N16.1 — UI shell

- React/TypeScript/Vite scaffold;
- same-origin dev proxy;
- service-health display;
- security baseline;
- no mutation controls.

### N16.2 — Observation store

- bootstrap;
- SSE connection;
- deduplication;
- replay handling;
- gap detection;
- stale-state handling.

### N16.3 — Task and runtime dashboard

- task navigator;
- task projection;
- budget presentation;
- model/provider observations.

### N16.4 — Execution-path visualization

- evidence-driven graph;
- active/terminal states;
- selected-node inspector.

### N16.5 — Event timeline

- filters;
- expandable sanitized payload;
- gap/replay/freshness semantics.

### N16.6 — UI Alpha qualification

- regression tests;
- browser security checks;
- real loopback qualification;
- trusted-state invariance;
- human design review.

---

## 32. Testing and Qualification Requirements

N16 must test:

- no mutation HTTP methods introduced unintentionally;
- no UI action invokes mutation;
- no raw API data bypasses normalization;
- duplicate SSE events do not duplicate state;
- reconnect replay is idempotent;
- sequence gaps are detected;
- missing events are never fabricated;
- keepalives are never rendered as events;
- stream loss does not create execution failure;
- stale data is visibly marked;
- timeout budgets are not labelled ETA;
- task-list and event-tail observer access produces no trusted-state mutation;
- browser observation produces no trusted-state mutation;
- CSP/security headers are present in production-style serving;
- no wildcard CORS is required;
- no external analytics or remote script dependency exists.

---

## 33. Explicit N16 Non-Goals

N16 does not implement:

- task creation;
- execution start;
- execution cancellation;
- execution retry;
- human approval;
- human rejection;
- model selection mutation;
- model loading/unloading;
- provider configuration;
- routing configuration;
- budget editing;
- task editing;
- policy editing;
- journal deletion;
- journal repair;
- LAN operation;
- Internet operation;
- multi-user authorization.

---

## 34. Deferred Capabilities

Deferred beyond N16:

- authenticated mutation control plane;
- human-approval submission;
- execution control;
- operator roles;
- remote access;
- multi-user sessions;
- configurable dashboards;
- persistent UI preferences;
- historical analytics;
- performance trend charts;
- predictive ETA;
- direct LM Studio management;
- model load/unload controls.

Each capability must cross the appropriate future authority or security gate.

---

## 35. A8 Acceptance Criteria

A8 is acceptable when:

- the UI remains observational;
- same-origin topology is frozen;
- no permissive CORS is required;
- browser data flow has an explicit normalization boundary;
- trusted, derived, and estimated data are separated;
- SSE reconnect/replay/gap behavior is deterministic;
- execution-path visualization is evidence-driven;
- timing semantics distinguish elapsed, consumed, limit, and estimate;
- model inventory and model binding are semantically distinct;
- human gates are presentation-only;
- task discovery and event-tail capability gaps are explicitly handled;
- production security-header direction is defined;
- resource-bounding assumptions are explicit;
- N16 implementation is decomposed into independently qualifiable slices.

---

## 36. Frozen A8 Architecture Contract

The N16 UI is a local, read-only, observability-first browser application.

It is served through a same-origin loopback architecture.

Its browser client consumes only qualified GET and SSE observer interfaces.

Raw transport data passes through schema validation and a deterministic
observation reducer before it reaches presentation components.

The reducer owns event ordering, replay deduplication, sequence-gap detection,
and connectivity state.

Presentation components consume view models.

They do not independently interpret trusted-state semantics.

Observed facts, client-derived metrics, and predictions remain visibly and
structurally distinct.

Execution-path state is rendered only from qualified observations and explicit
deterministic projection rules.

The UI does not infer model health from inventory, execution success from model
binding, task health from transport connectivity, or ETA from timeout budgets.

N16.0 may add narrowly bounded read-only task-discovery and event-tail observer
seams, provided they receive the same isolation, no-mutation, regression, and
loopback qualification applied to N15a.

No browser interaction in N16 grants trusted transition authority.

Any future writable control must cross a separately designed and qualified
authority boundary.
