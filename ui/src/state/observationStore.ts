import type {
  EventTailResponse,
  OrchestratorEvent,
  ServiceHealth,
  TaskStatusProjectionCollection,
} from "../api/schemas";


export const OBSERVATION_EVENT_WINDOW_LIMIT =
  100;


export interface ObservedState {
  readonly health:
    ServiceHealth | null;

  readonly tasks:
    TaskStatusProjectionCollection | null;

  readonly eventTail:
    EventTailResponse | null;

  /**
   * Browser-retained bounded window of validated event
   * evidence.
   *
   * The events themselves are observations. The retention
   * policy is browser-local and does not make this a durable
   * journal or trusted orchestrator state.
   */
  readonly eventWindow:
    readonly OrchestratorEvent[];
}


export interface DerivedObservationMetadata {
  /**
   * Local derivative of the validated bootstrap event tail.
   *
   * This is not a trusted observation. It is kept explicitly
   * separate from `observed` so downstream code cannot confuse
   * a browser-derived cursor with server-provided evidence.
   */
  readonly bootstrapEventCursor:
    number | null;

  /**
   * Browser-local continuation cursor.
   *
   * null:
   *   no validated event-tail baseline has been established.
   *
   * 0:
   *   a validated empty event-tail baseline was observed.
   *
   * N > 0:
   *   the latest event sequence represented by the validated
   *   bootstrap baseline and subsequent strictly sequential
   *   accepted-event transitions.
   *
   * This value is derived browser metadata, never trusted
   * orchestrator state.
   */
  readonly currentEventCursor:
    number | null;
}


export interface ObservationState {
  readonly observed:
    ObservedState;

  readonly derived:
    DerivedObservationMetadata;
}


export type ObservationAction =
  | {
      readonly type:
        "observation/health";
      readonly observation:
        ServiceHealth;
    }
  | {
      readonly type:
        "observation/tasks";
      readonly observation:
        TaskStatusProjectionCollection;
    }
  | {
      readonly type:
        "observation/event-tail";
      readonly observation:
        EventTailResponse;
    }
  | {
      readonly type:
        "observation/event-accepted";

      readonly event:
        OrchestratorEvent;
    }
  | {
      readonly type:
        "observation/reset";
    };


export type ObservationListener =
  () => void;


export interface ObservationStore {
  getSnapshot:
    () => ObservationState;

  dispatch:
    (
      action: ObservationAction,
    ) => void;

  subscribe:
    (
      listener: ObservationListener,
    ) => () => void;
}


function deepFreeze(
  value: unknown,
): void {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
  ) {
    return;
  }

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(child);
  }

  Object.freeze(value);
}


function immutableClone<T>(
  value: T,
): T {
  const clone = structuredClone(
    value,
  );

  deepFreeze(clone);

  return clone;
}


export function createInitialObservationState():
  ObservationState {
  return immutableClone({
    observed: {
      health: null,
      tasks: null,
      eventTail: null,

      eventWindow: [],
    },

    derived: {
      bootstrapEventCursor: null,

      currentEventCursor: null,
    },
  });
}


function deriveBootstrapEventCursor(
  eventTail: EventTailResponse,
): number | null {
  if (
    eventTail.events.length === 0
  ) {
    return null;
  }

  /*
   * parseEventTailResponse() guarantees that events are
   * strictly ascending by event_seq. Therefore the final
   * validated event is the maximum observed bootstrap seq.
   */
  return eventTail.events[
    eventTail.events.length - 1
  ].event_seq;
}


function deriveBootstrapEventWindow(
  eventTail:
    EventTailResponse,
): readonly OrchestratorEvent[] {
  return eventTail.events.slice(
    -OBSERVATION_EVENT_WINDOW_LIMIT,
  );
}


function appendBoundedEvent(
  eventWindow:
    readonly OrchestratorEvent[],

  event:
    OrchestratorEvent,
): readonly OrchestratorEvent[] {
  return [
    ...eventWindow,
    event,
  ].slice(
    -OBSERVATION_EVENT_WINDOW_LIMIT,
  );
}


export function reduceObservationState(
  state: ObservationState,
  action: ObservationAction,
): ObservationState {
  switch (action.type) {
    case "observation/health":
      return immutableClone({
        observed: {
          ...state.observed,

          health:
            action.observation,
        },

        derived:
          state.derived,
      });


    case "observation/tasks":
      return immutableClone({
        observed: {
          ...state.observed,

          tasks:
            action.observation,
        },

        derived:
          state.derived,
      });


    case "observation/event-tail": {
      const eventTail =
        immutableClone(
          action.observation,
        );

      const bootstrapEventCursor =
        deriveBootstrapEventCursor(
          eventTail,
        );

      return immutableClone({
        observed: {
          ...state.observed,

          eventTail,

          eventWindow:
            deriveBootstrapEventWindow(
              eventTail,
            ),
        },

        derived: {
          ...state.derived,

          bootstrapEventCursor,

          /*
           * An empty validated tail is still a valid baseline:
           * live continuation therefore begins after cursor 0.
           */
          currentEventCursor:
            bootstrapEventCursor
            ?? 0,
        },
      });
    }


    case "observation/event-accepted": {
      const currentEventCursor =
        state
          .derived
          .currentEventCursor;

      if (
        currentEventCursor
        === null
      ) {
        throw new TypeError(
          "accepted events require a validated event-tail baseline",
        );
      }

      const expectedEventSeq =
        currentEventCursor + 1;

      if (
        action.event.event_seq
        !== expectedEventSeq
      ) {
        throw new TypeError(
          "accepted event must be exactly the next event sequence",
        );
      }

      return immutableClone({
        observed: {
          ...state.observed,

          eventWindow:
            appendBoundedEvent(
              state
                .observed
                .eventWindow,

              action.event,
            ),
        },

        derived: {
          ...state.derived,

          currentEventCursor:
            action.event.event_seq,
        },
      });
    }


    case "observation/reset":
      return createInitialObservationState();
  }
}


export function createObservationStore(
  initialState:
    ObservationState =
      createInitialObservationState(),
): ObservationStore {
  let state =
    immutableClone(
      initialState,
    );

  const listeners =
    new Set<
      ObservationListener
    >();


  const getSnapshot =
    (): ObservationState => (
      state
    );


  const dispatch = (
    action: ObservationAction,
  ): void => {
    const nextState =
      reduceObservationState(
        state,
        action,
      );

    state = nextState;

    for (
      const listener
      of [...listeners]
    ) {
      listener();
    }
  };


  const subscribe = (
    listener: ObservationListener,
  ): (() => void) => {
    listeners.add(
      listener,
    );

    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }

      subscribed = false;

      listeners.delete(
        listener,
      );
    };
  };


  return Object.freeze({
    getSnapshot,
    dispatch,
    subscribe,
  });
}
