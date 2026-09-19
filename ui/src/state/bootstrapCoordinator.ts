import type {
  EventTailResponse,
  ServiceHealth,
  TaskStatusProjectionCollection,
} from "../api/schemas";

import type {
  ObservationStore,
} from "./observationStore";


export interface BootstrapReaders {
  readonly readHealth:
    (
      signal?: AbortSignal,
    ) => Promise<ServiceHealth>;

  readonly readTasks:
    (
      signal?: AbortSignal,
    ) => Promise<TaskStatusProjectionCollection>;

  readonly readEventTail:
    (
      signal?: AbortSignal,
    ) => Promise<EventTailResponse>;
}


export interface BootstrapObservationReceiptRecorder {
  /**
   * Record browser-local receipt only after the corresponding
   * validated observation has successfully crossed the
   * ObservationStore boundary.
   *
   * This interface deliberately owns no freshness policy,
   * clock, transport, or trusted-state authority.
   */
  readonly markObserved:
    (
      source:
        | "health"
        | "tasks"
        | "eventTail",
    ) => void;
}


export type BootstrapSourceStatus =
  | "not_attempted"
  | "observed"
  | "failed"
  | "aborted";


export type BootstrapOutcome =
  | "complete"
  | "partial"
  | "failed"
  | "aborted";


export interface BootstrapSourceResults {
  readonly health:
    BootstrapSourceStatus;

  readonly tasks:
    BootstrapSourceStatus;

  readonly eventTail:
    BootstrapSourceStatus;
}


export interface BootstrapResult {
  /**
   * Browser-local bootstrap outcome.
   *
   * This is operational metadata about the observation attempt.
   * It is not trusted orchestrator state.
   */
  readonly outcome:
    BootstrapOutcome;

  readonly sources:
    BootstrapSourceResults;
}


type ReadAttempt<T> =
  | {
      readonly kind:
        "observed";

      readonly observation:
        T;
    }
  | {
      readonly kind:
        "failed";
    }
  | {
      readonly kind:
        "aborted";
    };


interface MutableBootstrapSourceResults {
  health:
    BootstrapSourceStatus;

  tasks:
    BootstrapSourceStatus;

  eventTail:
    BootstrapSourceStatus;
}


/*
 * AbortSignal may be changed by another actor while an awaited
 * operation is in progress. Reading it through a function prevents
 * TypeScript control-flow narrowing from treating an earlier
 * observation as permanently authoritative.
 */
function isAbortRequested(
  signal?: AbortSignal,
): boolean {
  return signal?.aborted ?? false;
}


async function attemptRead<T>(
  reader:
    (
      signal?: AbortSignal,
    ) => Promise<T>,

  signal?: AbortSignal,
): Promise<ReadAttempt<T>> {
  if (isAbortRequested(signal)) {
    return {
      kind: "aborted",
    };
  }

  try {
    const observation =
      await reader(
        signal,
      );

    /*
     * A reader may resolve despite cancellation if the supplied
     * implementation does not honour AbortSignal. Never dispatch
     * such a result after the caller has withdrawn the bootstrap.
     */
    if (isAbortRequested(signal)) {
      return {
        kind: "aborted",
      };
    }

    return {
      kind: "observed",
      observation,
    };
  }
  catch {
    if (isAbortRequested(signal)) {
      return {
        kind: "aborted",
      };
    }

    return {
      kind: "failed",
    };
  }
}


function freezeBootstrapResult(
  sources:
    MutableBootstrapSourceResults,

  forcedOutcome?:
    BootstrapOutcome,
): BootstrapResult {
  const frozenSources:
    BootstrapSourceResults =
      Object.freeze({
        health:
          sources.health,

        tasks:
          sources.tasks,

        eventTail:
          sources.eventTail,
      });

  if (forcedOutcome !== undefined) {
    return Object.freeze({
      outcome:
        forcedOutcome,

      sources:
        frozenSources,
    });
  }

  const statuses =
    Object.values(
      frozenSources,
    );

  const observedCount =
    statuses.filter(
      (status) => (
        status === "observed"
      ),
    ).length;

  const outcome:
    BootstrapOutcome =
      observedCount === 3
        ? "complete"
        : observedCount === 0
          ? "failed"
          : "partial";

  return Object.freeze({
    outcome,
    sources:
      frozenSources,
  });
}


export async function bootstrapObservations(
  store:
    ObservationStore,

  readers:
    BootstrapReaders,

  signal?: AbortSignal,

  receiptRecorder?:
    BootstrapObservationReceiptRecorder,
): Promise<BootstrapResult> {
  const sources:
    MutableBootstrapSourceResults = {
      health:
        "not_attempted",

      tasks:
        "not_attempted",

      eventTail:
        "not_attempted",
    };


  // ----------------------------------------------------------
  // Health
  // ----------------------------------------------------------

  const health =
    await attemptRead(
      readers.readHealth,
      signal,
    );

  if (health.kind === "aborted") {
    sources.health =
      "aborted";

    return freezeBootstrapResult(
      sources,
      "aborted",
    );
  }

  if (health.kind === "failed") {
    sources.health =
      "failed";
  }
  else {
    store.dispatch({
      type:
        "observation/health",

      observation:
        health.observation,
    });


    receiptRecorder
      ?.markObserved(
        "health",
      );


    sources.health =
      "observed";
  }


  // ----------------------------------------------------------
  // Tasks
  // ----------------------------------------------------------

  const tasks =
    await attemptRead(
      readers.readTasks,
      signal,
    );

  if (tasks.kind === "aborted") {
    sources.tasks =
      "aborted";

    return freezeBootstrapResult(
      sources,
      "aborted",
    );
  }

  if (tasks.kind === "failed") {
    sources.tasks =
      "failed";
  }
  else {
    store.dispatch({
      type:
        "observation/tasks",

      observation:
        tasks.observation,
    });


    receiptRecorder
      ?.markObserved(
        "tasks",
      );


    sources.tasks =
      "observed";
  }


  // ----------------------------------------------------------
  // Event tail
  // ----------------------------------------------------------

  const eventTail =
    await attemptRead(
      readers.readEventTail,
      signal,
    );

  if (
    eventTail.kind
    === "aborted"
  ) {
    sources.eventTail =
      "aborted";

    return freezeBootstrapResult(
      sources,
      "aborted",
    );
  }

  if (
    eventTail.kind
    === "failed"
  ) {
    sources.eventTail =
      "failed";
  }
  else {
    store.dispatch({
      type:
        "observation/event-tail",

      observation:
        eventTail.observation,
    });


    receiptRecorder
      ?.markObserved(
        "eventTail",
      );


    sources.eventTail =
      "observed";
  }


  return freezeBootstrapResult(
    sources,
  );
}
