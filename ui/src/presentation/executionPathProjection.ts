import type {
  OrchestratorEvent,
  TaskStatusProjection,
} from "../api/schemas";

import type {
  ObservationState,
} from "../state/observationStore";


export type ExecutionPathStage =
  | "request"
  | "task"
  | "routing"
  | "provider"
  | "model"
  | "budget"
  | "execution"
  | "evidence"
  | "verification"
  | "approval"
  | "transition"
  | "other";


export interface ExecutionPathTaskOption {
  readonly taskId:
    string;

  readonly status:
    string;

  readonly riskLevel:
    string;
}


export interface ExecutionPathEvent {
  readonly eventSeq:
    number;

  readonly eventType:
    string;

  readonly stage:
    ExecutionPathStage;

  readonly occurredAt:
    string;

  readonly sourceClass:
    string;

  readonly component:
    string;

  readonly executionId:
    string | null;

  readonly parentExecutionId:
    string | null;

  readonly requestId:
    string | null;

  readonly workerRole:
    string | null;

  readonly providerId:
    string | null;

  readonly modelId:
    string | null;

  readonly stateBefore:
    string | null;

  readonly stateAfter:
    string | null;

  readonly reasonCode:
    string | null;

  readonly evidenceCount:
    number;
}


export interface ExecutionPathPresentation {
  readonly tasksObserved:
    boolean;

  /**
   * Source-provided bounded task collection completeness.
   *
   * null means no validated task snapshot has been observed.
   * true means additional tasks may exist outside this
   * observed browser snapshot.
   */
  readonly taskCollectionTruncated:
    boolean | null;

  readonly taskOptions:
    readonly ExecutionPathTaskOption[];

  readonly selectedTaskId:
    string | null;

  readonly selectedTask:
    ExecutionPathTaskOption | null;

  readonly eventBaselineObserved:
    boolean;

  readonly retainedEventCount:
    number;

  readonly retainedFirstEventSeq:
    number | null;

  readonly retainedLastEventSeq:
    number | null;

  /**
   * Exact task-linked events only.
   *
   * No request_id, execution_id, parent_execution_id, model,
   * provider, timestamp, or ordering heuristic is used to infer
   * ownership of an event whose task_id does not exactly match
   * the explicit browser-local task selection.
   */
  readonly pathEvents:
    readonly ExecutionPathEvent[];
}


function classifyEvent(
  eventType:
    string,
): ExecutionPathStage {
  if (
    eventType.startsWith(
      "request.",
    )
  ) {
    return "request";
  }

  if (
    eventType.startsWith(
      "task.",
    )
  ) {
    return "task";
  }

  if (
    eventType.startsWith(
      "routing.",
    )
  ) {
    return "routing";
  }

  if (
    eventType.startsWith(
      "provider.",
    )
  ) {
    return "provider";
  }

  if (
    eventType.startsWith(
      "model.",
    )
  ) {
    return "model";
  }

  if (
    eventType ===
    "budget.resolved"
  ) {
    return "budget";
  }

  if (
    eventType.startsWith(
      "execution.",
    )
  ) {
    return "execution";
  }

  if (
    eventType.startsWith(
      "evidence.",
    )
  ) {
    return "evidence";
  }

  if (
    eventType.startsWith(
      "verification.",
    )
  ) {
    return "verification";
  }

  if (
    eventType.startsWith(
      "approval.",
    )
  ) {
    return "approval";
  }

  if (
    eventType.startsWith(
      "transition.",
    )
  ) {
    return "transition";
  }

  return "other";
}


function projectTask(
  task:
    TaskStatusProjection,
): ExecutionPathTaskOption {
  return Object.freeze({
    taskId:
      task.task_id,

    status:
      task.status,

    riskLevel:
      task.risk_level,
  });
}


function projectEvent(
  event:
    OrchestratorEvent,
): ExecutionPathEvent {
  return Object.freeze({
    eventSeq:
      event.event_seq,

    eventType:
      event.event_type,

    stage:
      classifyEvent(
        event.event_type,
      ),

    occurredAt:
      event.occurred_at,

    sourceClass:
      event.source_class,

    component:
      event.component,

    executionId:
      event.execution_id,

    parentExecutionId:
      event.parent_execution_id,

    requestId:
      event.request_id,

    workerRole:
      event.worker_role,

    providerId:
      event.provider_id,

    modelId:
      event.model_id,

    stateBefore:
      event.state_before,

    stateAfter:
      event.state_after,

    reasonCode:
      event.reason_code,

    evidenceCount:
      event.evidence_refs.length,
  });
}


export function createExecutionPathPresentation(
  observation:
    ObservationState,

  selectedTaskId:
    string | null,
): ExecutionPathPresentation {
  const taskObservation =
    observation
      .observed
      .tasks;

  const tasks =
    taskObservation
      ?.tasks
      ?? [];

  const eventWindow =
    observation
      .observed
      .eventWindow;


  const taskOptions =
    Object.freeze(
      tasks.map(
        projectTask,
      ),
    );


  const selectedTask =
    selectedTaskId
    === null
      ? null
      : taskOptions.find(
          (
            task,
          ) => (
            task.taskId
            === selectedTaskId
          ),
        )
        ?? null;


  const pathEvents =
    selectedTaskId
    === null
      ? Object.freeze(
          [] as ExecutionPathEvent[],
        )
      : Object.freeze(
          eventWindow
            .filter(
              (
                event,
              ) => (
                event.task_id
                === selectedTaskId
              ),
            )
            .map(
              projectEvent,
            ),
        );


  return Object.freeze({
    tasksObserved:
      taskObservation
      !== null,

    taskCollectionTruncated:
      taskObservation
        ?.truncated
      ?? null,

    taskOptions,

    selectedTaskId,

    selectedTask,

    eventBaselineObserved:
      observation
        .observed
        .eventTail
      !== null,

    retainedEventCount:
      eventWindow.length,

    retainedFirstEventSeq:
      eventWindow[0]
        ?.event_seq
      ?? null,

    retainedLastEventSeq:
      eventWindow[
        eventWindow.length - 1
      ]?.event_seq
      ?? null,

    pathEvents,
  });
}
