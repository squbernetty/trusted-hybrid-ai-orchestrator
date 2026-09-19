# Trusted Hybrid AI Orchestrator

**A trust-centered control plane for AI-assisted work.**

AI models are treated as fallible workers, not trusted authorities. The purpose of this project is not to maximize agent autonomy or model orchestration. Its purpose is to make AI-assisted work bounded, inspectable, attributable, verifiable where possible, and subject to human authority.

The runtime is intended for engineering, software development, research, deep analysis, document review, data analysis, and other knowledge-work workflows where AI output must not silently become trusted authority.

The core design rule is:

> **The trustworthy unit is not the agent. The trustworthy unit is the verified state transition.**

**AI proposes. Evidence verifies. Policy constrains. Humans retain authority.**

The runtime separates supervisor requests, worker-model execution, human authority, deterministic verification, evidence, task state, and provenance.

## Trust model

Trust is established through process and evidence rather than model confidence.

The runtime is designed around:

- **policy-constrained authority** — workers may propose or execute bounded work but do not inherit approval authority;
- **human oversight** — consequential transitions remain subject to explicit human authority;
- **deterministic verification** — tests, compilation, schemas, calculations, static checks, and diff integrity are used where deterministic evidence is available;
- **evidence-grounded review** — judgment-heavy work can require source grounding, explicit assumptions, challenge, adjudication, and human review rather than pretending certainty is deterministic;
- **regression discipline** — qualification harnesses detect behavioral regressions before changes are accepted;
- **static analysis** — tools such as Ruff and Python compilation provide machine-checkable quality gates for software workflows;
- **evidence and provenance** — execution, verification, decisions, sources, and state transitions can be recorded and inspected;
- **failure containment** — timeout, cancellation, malformed output, transport failure, stalled execution, or verification failure lead to controlled states rather than silent continuation;
- **controlled remediation and re-verification** — proposed corrections must pass back through the verification path before they can become trusted output.

## What this is not

This project is not primarily:

- a multi-agent framework;
- a prompt-routing library;
- an autonomous coding agent;
- an LLM gateway;
- a replacement for CI/CD;
- a system that assumes model output is trustworthy.

Model orchestration is a mechanism. **Trustworthy AI-assisted work is the objective.**

## Verification depends on the task

Not every task can be verified in the same way.

For deterministic or machine-checkable work, the trust path may include:

- unit and regression tests;
- compilation;
- static analysis;
- schema validation;
- deterministic calculations;
- diff and repository-integrity checks.

For analytical or judgment-heavy work, the trust path may instead include:

- source grounding and provenance;
- evidence packets;
- explicit assumptions and uncertainty;
- adversarial challenge;
- structured adjudication;
- human review and approval.

The runtime should not present judgment-heavy conclusions as deterministically verified merely because an AI model produced them.

## Release status

This repository implements the **v0.1 runtime contract** and has been published as a **public alpha**, beginning with `v0.1.0-alpha.1`.

The current codebase also includes a qualified **local read-only control plane** and **N16 UI Alpha**. These extend observability and operator decision support; they do **not** expand trusted mutation authority.

The alpha is intentionally constrained:

- worker delegation topology is star-shaped;
- local workers execute sequentially;
- supported local worker roles are `qwen` and `gemma`;
- LM Studio is the reference local provider;
- the external supervisor interface is a one-shot local process, not a network service;
- the external interface exposes only `status`, `preflight`, `delegate`, and `verify`;
- the FastAPI control plane exposes read-only health, task, event, event-tail, and SSE observation endpoints;
- the browser UI exposes exactly three operator surfaces: **Overview**, **Task / Execution**, and **Event Timeline**;
- browser-local selection, filters, freshness, transport state, cursors, and gap-repair state are presentation metadata, not trusted orchestrator state;
- the UI cannot approve, mutate task state, delegate work, cancel execution, commit, push, merge, tag, release, or otherwise exercise trusted transition authority;
- authority-bearing operations remain inside the trusted runtime and human approval boundary;
- confirmed LM Studio backend cancellation is not currently claimed;
- live progress streaming is not currently exposed by the LM Studio adapter.

## Version namespaces

Version numbers belong to separate compatibility namespaces:

- Runtime contract: `v0.1`
- Global policy: `1.1`
- Project profile schema: `1.0`
- External supervisor request schema: `1.0`
- External supervisor response schema: `1.0`

A change in one namespace does not automatically imply a change in the others.

## Qualified environment

The current qualified baseline has been exercised with:

- Windows
- Python `3.11.9`
- PyYAML `6.0.3`
- Node.js `24.21.0`
- npm `11.19.0`
- LM Studio exposing its OpenAI-compatible local API

The UI dependency contract is locked by `ui/package-lock.json`. CI installs the UI with `npm ci` and runs the complete UI Alpha qualification chain.

Other environments may work but are not yet part of the qualified baseline.

## Repository layout

```text
trusted-hybrid-ai-orchestrator/
├── orchestrator.py
├── control_plane_api.py
├── POLICY.md
├── global-policy.yaml
├── requirements.txt
├── schemas/
│   ├── project-profile.template.yaml
│   └── task-state.template.yaml
├── evals/
│   ├── qualification-suite.yaml
│   ├── runtime-regression.py
│   ├── control-plane-regression.py
│   ├── live-integration.py
│   └── results/
├── ui/
│   ├── package.json
│   ├── package-lock.json
│   ├── scripts/
│   └── src/
├── docs/
├── projects/
├── state/
└── traces/
```

`POLICY.md` is the normative human-readable policy.

`global-policy.yaml` is the machine-usable representation and should be updated whenever the normative policy changes.

Project profiles may tighten the global policy but may not silently weaken it.

Repository content, web content, tool output, worker output, and generated artifacts are untrusted data and cannot redefine policy or authority.

`projects/*.yaml`, `state/`, `traces/`, and behavioral qualification result YAML files are local runtime/development data and are intentionally not tracked.

## Read-only control plane and UI Alpha

The N16 control plane and browser UI are observation surfaces over qualified trusted-state and event-journal readers.

The control plane:

- is implemented by `control_plane_api.py`;
- exposes exactly six qualified `GET` routes;
- disables `/docs`, `/redoc`, and `/openapi.json`;
- exposes no POST, PUT, PATCH, or DELETE mutation route;
- uses read-only observer seams for task and event data;
- provides SSE as a transport for trusted event observations, not as transition authority.

The browser UI:

- is local and observability-first;
- uses **Overview**, **Task / Execution**, and **Event Timeline** surfaces;
- keeps task selection and event filtering browser-local;
- preserves trusted `event_seq` ordering;
- treats observation staleness, SSE transport state, observer integrity, and trusted execution state as separate concepts;
- discloses bounded task/event observations instead of implying complete durable history;
- remains non-authoritative even when displaying human-gate, verification, evidence, or transition events.

N16 assumes local single-operator use. It does not provide remote multi-user isolation, a browser authorization model for mutation, or a writable control plane. Any future writable control plane requires a separate architecture and qualification phase.

The current UI qualification entry point is:

```powershell
Push-Location .\ui
npm ci --no-audit --no-fund
npm run qualify
Pop-Location
```

This builds and qualifies the UI and exercises its bounded same-origin `/api` proxy contract against a local loopback test backend. It is a qualification path, not a claim of a packaged production deployment workflow.

## 1. Create the Python environment

From the repository root in PowerShell:

```powershell
py -3.11 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

Activating the virtual environment is not required. All examples below invoke its Python executable directly.

Confirm the CLI:

```powershell
& .\.venv\Scripts\python.exe .\orchestrator.py --help
```

## 2. Configure LM Studio

Start LM Studio and enable its local OpenAI-compatible API server.

The orchestrator defaults to:

```text
http://127.0.0.1:1234
```

It queries:

```text
GET  /v1/models
POST /v1/chat/completions
```

To use another LM Studio base URL, set:

```powershell
$env:AI_ORCHESTRATOR_LM_STUDIO_URL = "http://127.0.0.1:1234"
```

The current worker bindings recognize these exact LM Studio model IDs.

For the `qwen` role, in priority order:

```text
qwen/qwen3.5-9b
qwen/qwen3.5-4b
qwen/qwen3.8-27b
```

For the `gemma` role, in priority order:

```text
google/gemma-4-12b-qat
google/gemma-4-26b-a4b-qat
```

At least one model for a requested role must appear in LM Studio's `/v1/models` inventory using the expected ID.

## 3. Create local runtime directories

`state/` and `traces/` are runtime data and may not exist in a fresh clone.

```powershell
New-Item -ItemType Directory -Force .\projects, .\state, .\traces | Out-Null
```

## 4. Create a project profile

Copy the template:

```powershell
Copy-Item .\schemas\project-profile.template.yaml .\projects\example-project.yaml
```

Edit `projects/example-project.yaml`.

At minimum, replace the template placeholders required by the current runtime:

```yaml
schema_version: "1.0"

project:
  name: example-project
  path: C:/absolute/path/to/the/project
  purpose: Describe the project.
  lifecycle_stage: active_development

model_routing:
  local_worker_provider_id: lm_studio

budget:
  max_worker_calls: 2
  max_parallel_workers: 1
  local_worker_timeout_seconds: 300
```

Important invariants:

- `project.name` must match the task's `task.active_project`;
- `project.path` must resolve to an existing local path;
- `budget.max_worker_calls` must be a positive integer;
- `budget.max_parallel_workers` must currently equal `1`;
- `budget.local_worker_timeout_seconds` must be a positive integer;
- `model_routing.local_worker_provider_id` must be a non-empty provider ID and is `lm_studio` for the reference deployment.

The remaining profile fields should be completed according to the project's risk, authority, verification, architecture, and execution constraints.

## 5. Create task state

Copy the task template:

```powershell
Copy-Item .\schemas\task-state.template.yaml .\state\example-task.yaml
```

Edit `state/example-task.yaml`.

At minimum, establish a real task identity and matching contract metadata:

```yaml
schema_version: "1.0"

task:
  task_id: example-task
  objective: Describe the bounded objective.
  active_project: example-project
  class: engineering
  risk_level: LOW
  reasoning_mode: medium
  status: INTAKE

trace:
  policy_version: "1.1"
  project_profile_version: "1.0"
  supervisor_model: UNKNOWN
```

`task.active_project` must match `project.name` from the corresponding project profile.

## 6. Inspect and preflight the task

`status` is read-only, but it still loads and validates the complete policy/project/task contract.

```powershell
& .\.venv\Scripts\python.exe .\orchestrator.py status --task example-task
```

`preflight` additionally requires the configured project path to be a Git repository and requires LM Studio to be reachable.

```powershell
& .\.venv\Scripts\python.exe .\orchestrator.py preflight --task example-task
```

Preflight reports the task/project contract, Git branch and working-tree state, available worker bindings, and worker budget.

## 7. Delegate bounded worker work

Example:

```powershell
& .\.venv\Scripts\python.exe .\orchestrator.py `
    delegate `
    --task example-task `
    --role qwen `
    --work-product EXTRACT `
    --reason "Extract bounded repository evidence" `
    --expected-output "Structured evidence packet"
```

Available worker products are:

```text
EXTRACT
CLASSIFY
TRANSFORM
IMPLEMENT
CHALLENGE
GENERATE
SUMMARIZE
```

Use `--context-file` and `--context-symbol` when a smaller explicit context boundary is available.

The trusted orchestration core, not the provider, owns execution state, budgets, admissibility, retry lineage, authority, and provenance.

## 8. Configure and run deterministic verification

Verification checks are explicit. The runtime does not automatically discover tests.

The v0.1 runtime recognizes:

```text
unit_tests
python_compile
git_diff_check
```

For example, a Python project profile may contain:

```yaml
execution:
  test_commands:
    - .venv/Scripts/python.exe -m unittest discover -s tests -v
    - .venv/Scripts/python.exe -m py_compile app.py

authority:
  autonomous_verify:
    - unit_tests
    - python_compile
    - git_diff_check
```

The task declares the checks that must run:

```yaml
verification:
  required:
    - unit_tests
    - python_compile
    - git_diff_check
  completed: []
```

Each required check must either be listed under `project.authority.autonomous_verify` or be covered by an applicable A1 approval grant in task state.

Run verification with:

```powershell
& .\.venv\Scripts\python.exe .\orchestrator.py verify --task example-task
```

Verification is stateful. It records evidence and provenance, transitions the task into `VERIFY`, and transitions the task to `ADJUDICATE` after the verification run. A failed check, runtime failure, timeout, or detected worktree/index mutation also routes the task to `ADJUDICATE`.

The v0.1 verification executor only permits configured project `.venv/Scripts/python...` commands and Git for the supported checks.

## 9. External supervisor protocol

The reference external interface accepts one JSON request on standard input, executes one bounded operation, emits one JSON response line, and exits.

Example read-only status request:

```powershell
'{"schema_version":"1.0","request_id":"example-request-001","supervisor_id":"example-supervisor","operation":"status","task":"example-task","payload":{}}' | & .\.venv\Scripts\python.exe .\orchestrator.py external-request
```

The external v1 operation set is intentionally closed to:

```text
status
preflight
delegate
verify
```

External callers cannot directly invoke adjudication, human approval, apply-change, completion, staging, or commit authority.

Valid external `request_id` values are durably replay-controlled in `state/_external-request-ledger.sqlite3`. The runtime reserves a new request before dispatch. An identical duplicate with a stored terminal response replays that response without re-executing the operation. Reusing the same ID with different request content is rejected. A duplicate whose earlier request has no terminal response is treated as active or indeterminate and is never automatically re-executed. This provides duplicate suppression and conservative crash handling, not a general exactly-once guarantee across external side effects.

## 10. Regression and release qualification

Run the deterministic trusted-core and control-plane regression suites:

```powershell
& .\.venv\Scripts\python.exe .\evals\runtime-regression.py
& .\.venv\Scripts\python.exe .\evals\control-plane-regression.py
```

When Ruff is installed, run the Python static gates:

```powershell
& .\.venv\Scripts\python.exe -m ruff check `
    .\orchestrator.py `
    .\control_plane_api.py `
    .\evals\runtime-regression.py `
    .\evals\control-plane-regression.py `
    .\evals\live-integration.py

& .\.venv\Scripts\python.exe -m py_compile `
    .\orchestrator.py `
    .\control_plane_api.py `
    .\evals\runtime-regression.py `
    .\evals\control-plane-regression.py `
    .\evals\live-integration.py

git diff --check
```

Run the complete deterministic UI Alpha qualification:

```powershell
Push-Location .\ui
npm ci --no-audit --no-fund
npm run qualify
Pop-Location
```

CI runs the deterministic Python and UI qualification gates. It intentionally does **not** execute the environment-dependent live LM Studio qualification.

The separate live release qualification requires LM Studio and a compatible local worker model:

```powershell
& .\.venv\Scripts\python.exe .\evals\live-integration.py
```

The deterministic suites are intended for routine regression and CI. The live integration suite remains a separate human-controlled provider/runtime release qualification gate.

## Security and authority model

The human remains the final authority for consequential actions.

Worker models and external supervisors do not gain authority merely because they can request or technically perform an operation.

The runtime is designed around explicit contracts, bounded execution, deterministic verification, evidence, provenance, and human approval rather than autonomous trust in model output.

See `POLICY.md` for the normative authority and trust model.

## Current alpha limitations

The current alpha does not claim:

- arbitrary provider support without an implemented provider adapter;
- parallel local worker execution;
- recursive worker delegation;
- confirmed LM Studio backend cancellation;
- live streaming progress from the LM Studio adapter;
- automatic project-profile generation;
- automatic task-state initialization;
- trusted mutation, approval, or execution control from the browser UI;
- remote multi-user UI isolation or a browser authorization model;
- durable-journal completeness in the bounded browser event window;
- direct LM Studio management from the browser UI;
- a network-hosted external supervisor service;
- automatic reconciliation of active or indeterminate external requests after process interruption; such requests require explicit recovery;
- production-readiness or unattended consequential autonomy.

These constraints are deliberate and should not be silently bypassed.
