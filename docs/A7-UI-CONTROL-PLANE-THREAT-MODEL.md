# A7 — UI / Control-Plane Threat Model

Status: Draft for architecture qualification

Baseline: N15a read-only control plane

Qualified baseline tag:

`n15a-readonly-control-plane-qualified`

Qualified baseline commit:

`850c04a30588710b72bc1ebc8e31bf63330f9047`

---

## 1. Purpose

This document defines the security, authority, and trust model for the browser-based user interface planned for the Trusted Hybrid AI Orchestrator.

The purpose of A7 is not to define visual appearance.

The purpose is to define what the UI may observe, what it may derive, what it must never claim as authoritative, and which failures must remain unable to change trusted orchestrator state.

The governing principle is:

> The trustworthy unit is not the agent. The trustworthy unit is the verified state transition.

The UI is therefore not part of the trusted decision authority.

---

## 2. Scope

A7 covers the read-only UI architecture planned for N16.

In scope:

- browser UI;
- local HTTP control-plane API;
- Server-Sent Events;
- task-status observation;
- event-journal observation;
- provider and model visibility;
- execution-path visualization;
- timing and progress presentation;
- verification-state visualization;
- human-gate visualization;
- browser reconnect behavior;
- client-side derived metrics;
- browser-side caching and storage;
- local network exposure;
- information disclosure;
- denial-of-service against the observation surface;
- future transition from observation to controlled mutation.

Out of scope:

- trusted task mutation;
- execution start;
- execution cancellation;
- task retry;
- model reassignment;
- routing modification;
- budget modification;
- verification approval;
- human approval submission;
- remote multi-user access;
- Internet exposure;
- LAN exposure;
- authentication for remote operators;
- WebSocket-based command transport.

Those capabilities require a later authority model and must not be added implicitly during N16.

---

## 3. System Context

Current qualified observation path:

```text
Browser / future UI
        |
        | HTTP GET / SSE
        v
FastAPI control-plane adapter
        |
        | qualified observer functions
        v
Read-only projections
        |
        +----------------------+
        |                      |
        v                      v
Trusted task state       Event journal
                           SQLite RO
```

The browser is an observer.

The control-plane API is an adapter.

Neither is an authority source.

---

## 4. Trust Boundaries

### TB-1 — Browser boundary

The browser is untrusted.

The system must assume the browser may be:

- buggy;
- stale;
- compromised;
- instrumented by extensions;
- modified through developer tools;
- displaying outdated data;
- disconnected and reconnecting;
- running hostile JavaScript from another origin;
- rendering malicious or malformed observed content.

No browser state is authoritative.

### TB-2 — HTTP/SSE boundary

HTTP and SSE transport observed data.

Transport success does not prove trusted execution success.

Transport failure does not prove trusted execution failure.

The following are explicitly distinct:

```text
SSE disconnect
    !=
trusted execution failure

SSE reconnect
    !=
new orchestration request

SSE keepalive
    !=
trusted orchestrator event

HTTP 200
    !=
task success
```

### TB-3 — Control-plane adapter boundary

The control-plane adapter may:

- validate transport input;
- translate trusted observer results;
- serialize bounded projections;
- redact internal errors;
- manage SSE transport state.

It must not:

- mutate task state;
- append trusted events;
- invoke worker execution;
- select models;
- alter routing;
- approve transitions;
- write the event journal;
- become an alternate source of trusted facts.

### TB-4 — Trusted observer boundary

Only qualified observer functions may cross from the control plane into trusted orchestrator state.

Current observer seams:

- `read_task_status_projection()`
- `read_orchestrator_events_read_only()`

The HTTP adapter must not duplicate:

- filesystem trust decisions;
- task-path validation;
- SQLite journal access;
- journal repair;
- trusted state interpretation.

---

## 5. Core Security Invariant

The primary N16 security invariant is:

> Compromise, corruption, refresh, reconnect, replay, malfunction, or manipulation of the browser must not itself produce a trusted state transition.

Equivalent architectural rule:

```text
Browser
  UNTRUSTED
      |
      | GET / SSE only
      v
Control plane
  NON-AUTHORITATIVE
      |
      | observer seams only
      v
Trusted core
  AUTHORITATIVE
```

---

## 6. Authority Classes

### 6.1 Trusted observations

These values originate from qualified trusted-state or journal observations.

Examples:

- task ID;
- task status;
- project identifier;
- task class;
- risk level;
- reasoning mode;
- next action;
- worker-call budget;
- worker calls consumed;
- local runtime consumed;
- cloud worker calls consumed;
- checkpoint state;
- human-gate state;
- event sequence;
- event timestamp;
- event type;
- provider inventory observation;
- model binding;
- execution start;
- execution completion;
- execution timeout;
- execution failure;
- verification events;
- approval events.

The UI may display these as observed facts.

### 6.2 Derived UI metrics

Derived UI metrics are calculations made from trusted observations but are not themselves trusted orchestrator facts.

Examples:

- elapsed wall-clock time;
- time since latest event;
- event rate;
- percentage of worker-call budget consumed;
- percentage of runtime budget consumed;
- duration between two observed events;
- count of execution attempts;
- number of currently displayed events.

Derived metrics must be visually distinguishable from trusted observations.

The UI must never write derived metrics back into trusted state.

### 6.3 Predictions and estimates

Predictions and estimates are inherently uncertain.

Examples:

- estimated completion time;
- estimated remaining runtime;
- predicted next-stage duration;
- estimated total execution duration;
- predicted resource use.

Predictions must be explicitly labelled as estimates.

The UI must never reinterpret:

- timeout budget;
- maximum runtime;
- worker-call allowance;
- policy deadline;

as an ETA.

A timeout budget is not an ETA.

No ETA may be displayed unless an explicit estimation method exists.

---

## 7. Data Sensitivity

Read-only does not mean non-sensitive.

Observable data may disclose:

- task identifiers;
- project identifiers;
- execution state;
- model identifiers;
- provider information;
- routing decisions;
- resource budgets;
- checkpoint state;
- human approval state;
- system architecture details.

Therefore the observation interface is a confidentiality boundary even though it is not a mutation boundary.

---

## 8. Adversary Model

### A-1 — Malicious web content

A hostile website attempts to access the local control plane from the user's browser.

Relevant threats include:

- cross-origin requests;
- information disclosure;
- DNS rebinding;
- origin confusion;
- future CORS misconfiguration.

### A-2 — Malicious or compromised browser extension

A browser extension may:

- read rendered information;
- alter presentation;
- inject DOM content;
- falsify UI labels;
- observe network activity.

The UI cannot protect information from an extension with equivalent browser privileges.

Such compromise must still not grant trusted mutation authority.

### A-3 — Malicious local process

A local process may attempt to:

- query the API;
- establish many SSE connections;
- consume observer resources;
- probe endpoints;
- exploit parser or framework defects.

The read-only control plane must not translate local access into trusted authority.

### A-4 — Malformed trusted data

Unexpected but validly stored task or event data may attempt to break UI rendering.

The UI must treat all rendered strings as data, not executable markup.

### A-5 — Stale or reordered observation

Network interruption, browser suspension, or reconnect may cause:

- stale views;
- delayed events;
- replayed events;
- apparent sequence gaps.

The UI must use trusted `event_seq` ordering and must not invent events to fill sequence gaps.

### A-6 — Operator misunderstanding

A technically correct UI can still cause unsafe interpretation if its presentation implies more certainty than the evidence supports.

Examples:

- showing a timeout as an ETA;
- showing "healthy" merely because SSE remains connected;
- showing "complete" before trusted completion;
- treating model selection as successful execution;
- treating provider inventory as a model availability guarantee.

Operator misunderstanding and decision quality are therefore part of the threat model.

---

## 9. Threat and Abuse-Case Matrix

| ID | Threat / abuse case | Primary impact | Required control |
|---|---|---|---|
| T01 | Browser sends mutation request | Integrity | N16 API remains GET-only |
| T02 | UI fabricates local task state | Integrity / operator deception | Browser state never authoritative |
| T03 | SSE reconnect treated as new execution | Integrity | Reconnect is observation only |
| T04 | Keepalive rendered as trusted event | Integrity / operator deception | Keepalive remains transport metadata |
| T05 | Event replay displayed as new fact | Operator deception | Deduplicate/order by `event_seq` |
| T06 | Event gap silently ignored | Operator deception | Detect and visibly flag sequence gaps |
| T07 | Timeout displayed as ETA | Decision quality | Separate budget, elapsed time, ETA |
| T08 | Model binding displayed as successful execution | Decision quality | Distinct execution lifecycle states |
| T09 | Hostile event string executes in browser | Confidentiality / integrity | Framework escaping; no unsafe HTML |
| T10 | API exposed on LAN | Confidentiality | Bind only to `127.0.0.1` |
| T11 | Wildcard CORS added for convenience | Confidentiality | no wildcard CORS |
| T12 | Dev UI requires unsafe cross-origin API exposure | Confidentiality | Prefer same-origin proxy/static serving |
| T13 | Browser caches sensitive API responses | Confidentiality | Observer responses should use `Cache-Control: no-store` |
| T14 | Hostile site reads local API | Confidentiality | Same-origin design; no permissive CORS |
| T15 | DNS-rebinding/origin confusion reaches local API | Confidentiality | Origin/host architecture must be reviewed |
| T16 | Many SSE clients exhaust resources | Availability | Bound connection/polling model |
| T17 | One-second polling scales with every browser tab | Availability | Treat many SSE connections as bounded local resource |
| T18 | SSE transport failure becomes trusted failure event | Integrity | Transport failure never fabricates trusted event |
| T19 | API error leaks filesystem/internal diagnostics | Confidentiality | Continue bounded redacted errors |
| T20 | UI renders raw task YAML | Confidentiality | Use narrow task projection only |
| T21 | UI gains direct SQLite/file access | Integrity | All observation crosses qualified seams |
| T22 | Browser writes derived metrics into task state | Integrity | Derived metrics remain client-only |
| T23 | UI action silently becomes future command | Authority escalation | Mutation requires separate later contract |
| T24 | Browser refresh causes execution/retry | Integrity | GET/SSE must remain side-effect free |
| T25 | Multiple tabs alter orchestrator behavior | Integrity | Number of observers must not alter trusted state |
| T26 | Stale UI appears current | Decision quality | Display last observed event/time and connectivity state |
| T27 | Connectivity indicator implies system health | Decision quality | Separate transport health from execution health |
| T28 | UI suppresses failed/timeout events | Operator deception | Preserve lifecycle terminal states |
| T29 | Client-side filter hides security-relevant event without indication | Operator deception | Active filtering must be visibly indicated |
| T30 | Future POST endpoint bypasses approval policy | Integrity | Future mutation requires new authority threat model |

---

## 10. Browser Rendering Rules

The N16 UI must:

- use framework-native escaped rendering;
- avoid raw HTML insertion for observed values;
- avoid `dangerouslySetInnerHTML`;
- avoid dynamically executed JavaScript from observed data;
- avoid rendering event payload fields as trusted markup;
- avoid loading remote third-party scripts by default;
- avoid remote analytics by default;
- avoid transmitting orchestrator information to external services;
- avoid storing sensitive event history in persistent browser storage unless explicitly justified.

Preferred state storage:

- in-memory UI state;
- transient browser session state only where justified.

Persistent local storage is not a default requirement.

---

## 11. Network Rules

For N16 Alpha:

- backend remains bound to `127.0.0.1`;
- no `0.0.0.0`;
- no LAN exposure;
- no public Internet exposure;
- no wildcard CORS;
- no WebSocket command channel;
- no remote telemetry requirement.

Preferred deployment model:

```text
Browser
   |
   | same-origin
   v
Local UI host / development proxy
   |
   | loopback
   v
127.0.0.1 control plane
```

During development, a frontend development server should proxy API traffic rather than requiring permissive backend CORS.

A production-style local build should preferably use a same-origin serving model.

---

## 12. HTTP Cache Policy Requirement

The observation API may expose operationally sensitive data.

A7 therefore introduces the following requirement for A8/N16:

> Task and event observation responses should explicitly prevent persistent HTTP caching unless a later design provides a justified alternative.

Expected policy direction:

`Cache-Control: no-store`

SSE already uses:

`Cache-Control: no-cache`

This finding does not invalidate the qualified N15a read-only authority model.

It is an information-protection hardening requirement for the UI-serving architecture.

---

## 13. SSE Security Semantics

SSE event semantics are:

```text
id
    = trusted event_seq

event
    = trusted event type

data
    = canonical serialized trusted event
```

The client must:

- track the latest trusted event sequence;
- preserve ordering;
- recognize reconnect replay;
- detect sequence gaps;
- avoid creating synthetic trusted events;
- treat keepalives as transport-only;
- visibly represent disconnected/stale state.

The browser must not claim exactly-once delivery.

---

## 14. Execution Path Visualization

The UI may visualize an execution path only from observed trusted events and task state.

Example:

```text
request observed
    ->
routing decided
    ->
model binding selected
    ->
budget resolved
    ->
execution started
    ->
execution completed
    ->
verification
    ->
human gate
```

A path segment must not be displayed as completed merely because it is the expected next step.

Visual semantics should distinguish:

- observed/completed;
- currently active;
- expected but not observed;
- failed;
- timed out;
- awaiting human authority;
- unknown/stale.

---

## 15. Runtime and Timing Semantics

The UI must distinguish at least four concepts.

### Elapsed runtime

Observed or locally derived duration since a trusted start point.

### Runtime consumed

Trusted budget/accounting value when supplied by the orchestrator.

### Runtime limit

Maximum policy or execution allowance.

### Estimated remaining runtime

Prediction produced by an explicit estimation method.

These values must not be collapsed into one progress bar unless their semantics remain clear.

---

## 16. Model Visibility Semantics

The UI may display:

- observed provider inventory;
- model identifiers;
- selected model binding;
- worker role;
- routing decision.

The UI must not infer:

- that an inventory-listed model is currently healthy;
- that a selected model successfully loaded;
- that a binding completed inference;
- that a faster model is preferable;
- that a particular model is trusted.

Those conclusions require separate observed evidence.

---

## 17. Human Authority Semantics

A human gate shown in N16 is informational only.

Examples:

```text
PENDING
APPROVED
REJECTED
NOT REQUIRED
UNKNOWN
```

N16 must not provide a control that submits an approval.

A future approval button is a trusted mutation surface and requires:

- authenticated operator identity;
- authorization policy;
- replay protection;
- request identity;
- explicit decision evidence;
- audit event;
- origin/anti-CSRF protection as applicable;
- human confirmation semantics;
- dedicated threat-model update.

---

## 18. Failure Handling

### Browser failure

May lose presentation state.

Must not alter trusted state.

### SSE failure

May make the view stale.

Must not alter trusted state.

### HTTP observer failure

May make data unavailable.

Must not alter trusted state.

### Corrupt journal

Observer fails closed.

Observer must not repair the journal.

### UI parsing/rendering failure

UI may show an error.

Must not invent trusted state.

---

## 19. Availability and Resource Isolation

The observer surface can still consume resources.

Potential pressure sources:

- many browser tabs;
- many SSE connections;
- repeated GET polling;
- large event queries;
- malformed client behavior;
- local denial-of-service.

N16 should assume single-operator local use.

A8 must determine whether explicit connection or query limits are required before broader deployment.

Availability degradation of the observer must not become a trusted state transition.

---

## 20. Security Headers and Browser Policy

A8/N16 should define a local browser-security policy including, where applicable:

- Content-Security-Policy;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy`;
- frame-embedding restrictions;
- HTTP cache policy;
- restrictive origin behavior.

The exact policy belongs to A8 because it depends on the selected UI-serving architecture.

---

## 21. Residual Risks Accepted for N16 Alpha

N16 Alpha is expected to be:

- local;
- single-user;
- loopback-only;
- read-only;
- development/engineering focused.

Therefore A7 accepts that:

- a malicious local administrator can access local information;
- a privileged browser extension may read UI content;
- local denial-of-service may make observation unavailable;
- the UI does not provide remote multi-user isolation;
- the UI does not provide an authorization model because it has no trusted mutation authority.

These assumptions must be revisited before LAN or remote use.

---

## 22. Explicit N16 Non-Goals

N16 must not implement:

- Start;
- Stop;
- Cancel;
- Retry;
- Approve;
- Reject;
- Change model;
- Change provider;
- Change route;
- Change budget;
- Edit task;
- Edit policy;
- Delete event;
- Repair journal;
- Clear trusted state.

Any such capability moves the system from observation into authority.

---

## 23. Future Mutation Boundary

A future writable control plane must be treated as a separate architecture phase.

Conceptually:

```text
UNTRUSTED UI
     |
     | mutation request
     v
Authenticated request boundary
     |
     v
Authorization / policy
     |
     v
Replay protection
     |
     v
Human authority where required
     |
     v
Verified trusted transition
```

The UI itself must never become the transition authority.

---

## 24. A8 Design Requirements Derived from A7

A8 must resolve:

1. same-origin UI/API serving architecture;
2. browser security headers;
3. cache-control behavior;
4. SSE reconnect state;
5. event-gap presentation;
6. stale-data indication;
7. trusted versus derived versus predicted visual language;
8. execution-path state model;
9. model/provider information model;
10. timing semantics;
11. human-gate presentation;
12. event-filter visibility;
13. SSE resource limits;
14. development-server proxy architecture;
15. production local-serving architecture.

---

## 25. A7 Acceptance Criteria

A7 is acceptable when all of the following are true:

- browser is explicitly classified as untrusted;
- control plane is explicitly non-authoritative;
- trusted-state mutation remains impossible through N16 UI;
- GET/SSE observation model is preserved;
- reconnect and keepalive semantics are defined;
- trusted facts are separated from derived metrics;
- predictions are separated from observed facts;
- timeout/budget values cannot masquerade as ETA;
- confidentiality risks of read-only data are recognized;
- loopback-only deployment remains mandatory;
- permissive CORS is rejected;
- raw HTML rendering of observed data is rejected;
- stale-data behavior is defined;
- event ordering uses trusted event sequence;
- sequence gaps must be detectable;
- browser failure cannot create trusted state;
- SSE failure cannot create trusted state;
- future writable controls require a separate authority model.

---

## 26. Frozen A7 Security Contract

The N16 read-only UI is an untrusted visualization client.

It consumes only qualified read-only control-plane endpoints.

It may display trusted observations.

It may calculate clearly labelled derived metrics.

It may display clearly labelled estimates only when an explicit estimation method exists.

It may not create, alter, approve, reject, retry, cancel, or otherwise advance trusted orchestrator state.

A browser compromise may corrupt presentation or disclose information available to that browser.

A browser compromise must not, by itself, provide trusted transition authority.

That invariant remains mandatory until a later architecture phase explicitly introduces, models, implements, and qualifies a writable control plane.
