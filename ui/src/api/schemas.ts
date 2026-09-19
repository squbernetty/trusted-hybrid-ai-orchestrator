export type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type JsonObject = {
  [key: string]: JsonValue;
};


export interface ServiceHealth {
  status: "ok";
  service:
    "trusted-hybrid-ai-orchestrator-control-plane";
  api_version: "1.0";
  authority: "read_only";
}


export interface TaskStatusProjection {
  schema_version: string;
  task_id: string;
  active_project: string;
  task_class: string;
  risk_level: string;
  reasoning_mode: string;
  status: string;
  next_action: string | null;
  worker_calls_used: number;
  worker_calls_max: number;
  parallel_workers_active: number;
  local_runtime_seconds_used: number;
  cloud_worker_calls_used: number;
  checkpoint_last: string | null;
  checkpoint_resume_from: string | null;
  human_gate_status: string | null;
  human_gate_approval: string | null;
}


export interface TaskStatusProjectionCollection {
  tasks: TaskStatusProjection[];
  limit: number;
  truncated: boolean;
}


export type OrchestratorEventSource =
  | "trusted_core"
  | "execution_supervisor"
  | "provider"
  | "verification"
  | "human_authority";


export interface OrchestratorEvent {
  schema_version: "1.0";
  event_seq: number;
  event_id: string;
  event_type: string;
  occurred_at: string;
  source_class: OrchestratorEventSource;
  component: string;
  task_id: string | null;
  execution_id: string | null;
  parent_execution_id: string | null;
  request_id: string | null;
  worker_role: string | null;
  provider_id: string | null;
  model_id: string | null;
  state_before: string | null;
  state_after: string | null;
  reason_code: string | null;
  evidence_refs: string[];
  payload: JsonObject;
}


export interface EventTailResponse {
  events: OrchestratorEvent[];
  count: number;
  limit: number;
}


function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
  );
}


function canonicalString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
  ) {
    throw new Error(
      `Invalid ${field}.`,
    );
  }

  return value;
}


function nullableCanonicalString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }

  return canonicalString(
    value,
    field,
  );
}


function nonnegativeInteger(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(
      `Invalid ${field}.`,
    );
  }

  return value;
}


function positiveInteger(
  value: unknown,
  field: string,
): number {
  const parsed = nonnegativeInteger(
    value,
    field,
  );

  if (parsed === 0) {
    throw new Error(
      `Invalid ${field}.`,
    );
  }

  return parsed;
}


function nonnegativeFiniteNumber(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
  ) {
    throw new Error(
      `Invalid ${field}.`,
    );
  }

  return value;
}


function jsonValue(
  value: unknown,
  field: string,
): JsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid ${field}.`,
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item, index) => (
        jsonValue(
          item,
          `${field}[${index}]`,
        )
      ),
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(
        ([key, item]) => [
          key,
          jsonValue(
            item,
            `${field}.${key}`,
          ),
        ],
      ),
    );
  }

  throw new Error(
    `Invalid ${field}.`,
  );
}


function jsonObject(
  value: unknown,
  field: string,
): JsonObject {
  const parsed = jsonValue(
    value,
    field,
  );

  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
  ) {
    throw new Error(
      `Invalid ${field}.`,
    );
  }

  return parsed;
}


function utcTimestamp(
  value: unknown,
): string {
  const parsed = canonicalString(
    value,
    "event.occurred_at",
  );

  if (
    !(
      parsed.endsWith("Z")
      || parsed.endsWith("+00:00")
    )
    || Number.isNaN(
      Date.parse(parsed),
    )
  ) {
    throw new Error(
      "Invalid event.occurred_at.",
    );
  }

  return parsed;
}


function eventSource(
  value: unknown,
): OrchestratorEventSource {
  const parsed = canonicalString(
    value,
    "event.source_class",
  );

  switch (parsed) {
    case "trusted_core":
    case "execution_supervisor":
    case "provider":
    case "verification":
    case "human_authority":
      return parsed;

    default:
      throw new Error(
        "Invalid event.source_class.",
      );
  }
}


export function parseServiceHealth(
  value: unknown,
): ServiceHealth {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid control-plane health response.",
    );
  }

  if (
    value.status !== "ok"
    || value.service
      !== "trusted-hybrid-ai-orchestrator-control-plane"
    || value.api_version !== "1.0"
    || value.authority !== "read_only"
  ) {
    throw new Error(
      "Unexpected control-plane health contract.",
    );
  }

  return {
    status: "ok",
    service:
      "trusted-hybrid-ai-orchestrator-control-plane",
    api_version: "1.0",
    authority: "read_only",
  };
}


export function parseTaskStatusProjection(
  value: unknown,
): TaskStatusProjection {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid task-status projection.",
    );
  }

  return {
    schema_version: canonicalString(
      value.schema_version,
      "task.schema_version",
    ),

    task_id: canonicalString(
      value.task_id,
      "task.task_id",
    ),

    active_project: canonicalString(
      value.active_project,
      "task.active_project",
    ),

    task_class: canonicalString(
      value.task_class,
      "task.task_class",
    ),

    risk_level: canonicalString(
      value.risk_level,
      "task.risk_level",
    ),

    reasoning_mode: canonicalString(
      value.reasoning_mode,
      "task.reasoning_mode",
    ),

    status: canonicalString(
      value.status,
      "task.status",
    ),

    next_action: nullableCanonicalString(
      value.next_action,
      "task.next_action",
    ),

    worker_calls_used: nonnegativeInteger(
      value.worker_calls_used,
      "task.worker_calls_used",
    ),

    worker_calls_max: nonnegativeInteger(
      value.worker_calls_max,
      "task.worker_calls_max",
    ),

    parallel_workers_active:
      nonnegativeInteger(
        value.parallel_workers_active,
        "task.parallel_workers_active",
      ),

    local_runtime_seconds_used:
      nonnegativeFiniteNumber(
        value.local_runtime_seconds_used,
        "task.local_runtime_seconds_used",
      ),

    cloud_worker_calls_used:
      nonnegativeInteger(
        value.cloud_worker_calls_used,
        "task.cloud_worker_calls_used",
      ),

    checkpoint_last:
      nullableCanonicalString(
        value.checkpoint_last,
        "task.checkpoint_last",
      ),

    checkpoint_resume_from:
      nullableCanonicalString(
        value.checkpoint_resume_from,
        "task.checkpoint_resume_from",
      ),

    human_gate_status:
      nullableCanonicalString(
        value.human_gate_status,
        "task.human_gate_status",
      ),

    human_gate_approval:
      nullableCanonicalString(
        value.human_gate_approval,
        "task.human_gate_approval",
      ),
  };
}


export function parseTaskStatusProjectionCollection(
  value: unknown,
): TaskStatusProjectionCollection {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid task-list response.",
    );
  }

  if (!Array.isArray(value.tasks)) {
    throw new Error(
      "Invalid task-list tasks.",
    );
  }

  const limit = positiveInteger(
    value.limit,
    "task-list.limit",
  );

  if (limit > 1000) {
    throw new Error(
      "Invalid task-list.limit.",
    );
  }

  if (typeof value.truncated !== "boolean") {
    throw new Error(
      "Invalid task-list.truncated.",
    );
  }

  const tasks = value.tasks.map(
    parseTaskStatusProjection,
  );

  if (tasks.length > limit) {
    throw new Error(
      "Task-list exceeds declared limit.",
    );
  }

  return {
    tasks,
    limit,
    truncated: value.truncated,
  };
}


export function parseOrchestratorEvent(
  value: unknown,
): OrchestratorEvent {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid orchestrator event.",
    );
  }

  if (value.schema_version !== "1.0") {
    throw new Error(
      "Unsupported event schema version.",
    );
  }

  const evidenceRaw =
    value.evidence_refs;

  if (!Array.isArray(evidenceRaw)) {
    throw new Error(
      "Invalid event.evidence_refs.",
    );
  }

  const evidenceRefs =
    evidenceRaw.map(
      (item, index) => (
        canonicalString(
          item,
          `event.evidence_refs[${index}]`,
        )
      ),
    );

  if (
    new Set(evidenceRefs).size
    !== evidenceRefs.length
  ) {
    throw new Error(
      "Duplicate event evidence reference.",
    );
  }

  return {
    schema_version: "1.0",

    event_seq: positiveInteger(
      value.event_seq,
      "event.event_seq",
    ),

    event_id: canonicalString(
      value.event_id,
      "event.event_id",
    ),

    event_type: canonicalString(
      value.event_type,
      "event.event_type",
    ),

    occurred_at: utcTimestamp(
      value.occurred_at,
    ),

    source_class: eventSource(
      value.source_class,
    ),

    component: canonicalString(
      value.component,
      "event.component",
    ),

    task_id: nullableCanonicalString(
      value.task_id,
      "event.task_id",
    ),

    execution_id:
      nullableCanonicalString(
        value.execution_id,
        "event.execution_id",
      ),

    parent_execution_id:
      nullableCanonicalString(
        value.parent_execution_id,
        "event.parent_execution_id",
      ),

    request_id:
      nullableCanonicalString(
        value.request_id,
        "event.request_id",
      ),

    worker_role:
      nullableCanonicalString(
        value.worker_role,
        "event.worker_role",
      ),

    provider_id:
      nullableCanonicalString(
        value.provider_id,
        "event.provider_id",
      ),

    model_id:
      nullableCanonicalString(
        value.model_id,
        "event.model_id",
      ),

    state_before:
      nullableCanonicalString(
        value.state_before,
        "event.state_before",
      ),

    state_after:
      nullableCanonicalString(
        value.state_after,
        "event.state_after",
      ),

    reason_code:
      nullableCanonicalString(
        value.reason_code,
        "event.reason_code",
      ),

    evidence_refs: evidenceRefs,

    payload: jsonObject(
      value.payload,
      "event.payload",
    ),
  };
}


export function parseEventTailResponse(
  value: unknown,
): EventTailResponse {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid event-tail response.",
    );
  }

  if (!Array.isArray(value.events)) {
    throw new Error(
      "Invalid event-tail events.",
    );
  }

  const count = nonnegativeInteger(
    value.count,
    "event-tail.count",
  );

  const limit = positiveInteger(
    value.limit,
    "event-tail.limit",
  );

  if (limit > 1000) {
    throw new Error(
      "Invalid event-tail.limit.",
    );
  }

  const events = value.events.map(
    parseOrchestratorEvent,
  );

  if (count !== events.length) {
    throw new Error(
      "Event-tail count mismatch.",
    );
  }

  if (events.length > limit) {
    throw new Error(
      "Event-tail exceeds declared limit.",
    );
  }

  for (
    let index = 1;
    index < events.length;
    index += 1
  ) {
    if (
      events[index].event_seq
      <= events[index - 1].event_seq
    ) {
      throw new Error(
        "Event-tail sequence is not strictly ascending.",
      );
    }
  }

  return {
    events,
    count,
    limit,
  };
}
