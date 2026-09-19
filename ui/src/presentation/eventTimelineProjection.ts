import type {
  OrchestratorEvent,
  OrchestratorEventSource,
} from "../api/schemas";

import type {
  ObservationControllerSnapshot,
  ObservationControllerState,
} from "../state/observationController";

import type {
  ObservationState,
} from "../state/observationStore";


export interface EventTimelineFilters {
  readonly eventType:
    string | null;

  readonly sourceClass:
    OrchestratorEventSource | null;

  readonly taskId:
    string | null;

  readonly executionId:
    string | null;

  readonly requestId:
    string | null;
}


export const EMPTY_EVENT_TIMELINE_FILTERS:
  EventTimelineFilters =
    Object.freeze({
      eventType:
        null,

      sourceClass:
        null,

      taskId:
        null,

      executionId:
        null,

      requestId:
        null,
    });


export interface EventTimelineItem {
  readonly eventSeq:
    number;

  readonly eventType:
    string;

  readonly occurredAt:
    string;

  readonly sourceClass:
    OrchestratorEventSource;

  readonly component:
    string;

  readonly taskId:
    string | null;

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


export interface EventTimelinePresentation {
  /**
   * Whether a validated bootstrap event-tail snapshot has ever
   * established the browser event baseline.
   *
   * This is not SSE liveness or stream completeness.
   */
  readonly eventBaselineObserved:
    boolean;

  /**
   * Bounded browser retention count, never durable-journal size.
   */
  readonly retainedEventCount:
    number;

  readonly retainedFirstEventSeq:
    number | null;

  readonly retainedLastEventSeq:
    number | null;

  /**
   * Browser-derived continuation cursor.
   *
   * This is deliberately presentation metadata and not trusted
   * orchestrator state.
   */
  readonly currentEventCursor:
    number | null;

  /**
   * Browser-local observation-controller metadata.
   *
   * Controller state must never be presented as trusted
   * execution state.
   */
  readonly controllerState:
    ObservationControllerState;

  readonly sessionGeneration:
    number;

  readonly retainedGapEventSeq:
    number | null;

  readonly eventTypeOptions:
    readonly string[];

  readonly sourceClassOptions:
    readonly OrchestratorEventSource[];

  readonly filteredEventCount:
    number;

  /**
   * Filtered view over the already-qualified retained event
   * window. Source order is preserved exactly; no sorting,
   * correlation, reconstruction, or inferred events occur here.
   */
  readonly events:
    readonly EventTimelineItem[];
}


function projectEvent(
  event:
    OrchestratorEvent,
): EventTimelineItem {
  return Object.freeze({
    eventSeq:
      event.event_seq,

    eventType:
      event.event_type,

    occurredAt:
      event.occurred_at,

    sourceClass:
      event.source_class,

    component:
      event.component,

    taskId:
      event.task_id,

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


function matchesFilters(
  event:
    OrchestratorEvent,

  filters:
    EventTimelineFilters,
): boolean {
  if (
    filters.eventType !== null
    && event.event_type
      !== filters.eventType
  ) {
    return false;
  }

  if (
    filters.sourceClass !== null
    && event.source_class
      !== filters.sourceClass
  ) {
    return false;
  }

  if (
    filters.taskId !== null
    && event.task_id
      !== filters.taskId
  ) {
    return false;
  }

  if (
    filters.executionId !== null
    && event.execution_id
      !== filters.executionId
  ) {
    return false;
  }

  if (
    filters.requestId !== null
    && event.request_id
      !== filters.requestId
  ) {
    return false;
  }

  return true;
}


function uniqueEventTypes(
  events:
    readonly OrchestratorEvent[],
): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        events.map(
          (
            event,
          ) => (
            event.event_type
          ),
        ),
      ),
    ],
  );
}


function uniqueSourceClasses(
  events:
    readonly OrchestratorEvent[],
): readonly OrchestratorEventSource[] {
  return Object.freeze(
    [
      ...new Set(
        events.map(
          (
            event,
          ) => (
            event.source_class
          ),
        ),
      ),
    ],
  );
}


export function createEventTimelinePresentation(
  observation:
    ObservationState,

  controller:
    ObservationControllerSnapshot,

  filters:
    EventTimelineFilters =
      EMPTY_EVENT_TIMELINE_FILTERS,
): EventTimelinePresentation {
  const eventWindow =
    observation
      .observed
      .eventWindow;


  const events =
    Object.freeze(
      eventWindow
        .filter(
          (
            event,
          ) => (
            matchesFilters(
              event,
              filters,
            )
          ),
        )
        .map(
          projectEvent,
        ),
    );


  return Object.freeze({
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

    currentEventCursor:
      observation
        .derived
        .currentEventCursor,

    controllerState:
      controller.state,

    sessionGeneration:
      controller.sessionGeneration,

    retainedGapEventSeq:
      controller.retainedGapEventSeq,

    eventTypeOptions:
      uniqueEventTypes(
        eventWindow,
      ),

    sourceClassOptions:
      uniqueSourceClasses(
        eventWindow,
      ),

    filteredEventCount:
      events.length,

    events,
  });
}
