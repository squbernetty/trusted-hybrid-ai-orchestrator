import type {
  OrchestratorEvent,
  TaskStatusProjection,
} from "../api/schemas";

import type {
  ObservationControllerSnapshot,
  ObservationControllerState,
} from "../state/observationController";

import type {
  ObservationState,
} from "../state/observationStore";


export const OVERVIEW_TASK_DISPLAY_LIMIT =
  6;

export const OVERVIEW_EVENT_DISPLAY_LIMIT =
  6;


export interface OverviewTaskItem {
  readonly taskId:
    string;

  readonly status:
    string;

  readonly riskLevel:
    string;

  readonly nextAction:
    string | null;

  readonly humanGateStatus:
    string | null;

  readonly humanGateApproval:
    string | null;
}


export interface OverviewEventItem {
  readonly eventSeq:
    number;

  readonly eventType:
    string;

  readonly occurredAt:
    string;

  readonly sourceClass:
    string;

  readonly taskId:
    string | null;

  readonly executionId:
    string | null;

  readonly evidenceCount:
    number;
}


export interface OverviewPresentation {
  /**
   * Browser presentation metadata only.
   *
   * This projection never becomes trusted orchestrator state.
   */
  readonly controllerState:
    ObservationControllerState;

  readonly sessionGeneration:
    number;

  readonly retainedGapEventSeq:
    number | null;

  readonly tasksObserved:
    boolean;

  readonly taskCount:
    number | null;

  readonly taskCollectionTruncated:
    boolean | null;

  readonly taskItems:
    readonly OverviewTaskItem[];

  readonly eventBaselineObserved:
    boolean;

  readonly retainedEventCount:
    number;

  readonly eventItems:
    readonly OverviewEventItem[];

  /**
   * Browser-derived continuation cursor.
   *
   * This is deliberately exposed as browser metadata and must
   * never be presented as trusted orchestrator state.
   */
  readonly currentEventCursor:
    number | null;
}


function projectTask(
  task:
    TaskStatusProjection,
): OverviewTaskItem {
  return Object.freeze({
    taskId:
      task.task_id,

    status:
      task.status,

    riskLevel:
      task.risk_level,

    nextAction:
      task.next_action,

    humanGateStatus:
      task.human_gate_status,

    humanGateApproval:
      task.human_gate_approval,
  });
}


function projectEvent(
  event:
    OrchestratorEvent,
): OverviewEventItem {
  return Object.freeze({
    eventSeq:
      event.event_seq,

    eventType:
      event.event_type,

    occurredAt:
      event.occurred_at,

    sourceClass:
      event.source_class,

    taskId:
      event.task_id,

    executionId:
      event.execution_id,

    evidenceCount:
      event.evidence_refs.length,
  });
}


export function createOverviewPresentation(
  observation:
    ObservationState,

  controller:
    ObservationControllerSnapshot,
): OverviewPresentation {
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


  const taskItems =
    Object.freeze(
      tasks
        .slice(
          0,
          OVERVIEW_TASK_DISPLAY_LIMIT,
        )
        .map(
          projectTask,
        ),
    );


  const eventItems =
    Object.freeze(
      eventWindow
        .slice(
          -OVERVIEW_EVENT_DISPLAY_LIMIT,
        )
        .map(
          projectEvent,
        ),
    );


  return Object.freeze({
    controllerState:
      controller.state,

    sessionGeneration:
      controller.sessionGeneration,

    retainedGapEventSeq:
      controller.retainedGapEventSeq,

    tasksObserved:
      taskObservation
      !== null,

    taskCount:
      taskObservation
        ?.tasks
        .length
      ?? null,

    taskCollectionTruncated:
      taskObservation
        ?.truncated
      ?? null,

    taskItems,

    eventBaselineObserved:
      observation
        .observed
        .eventTail
      !== null,

    retainedEventCount:
      eventWindow.length,

    eventItems,

    currentEventCursor:
      observation
        .derived
        .currentEventCursor,
  });
}
