export const TRUSTED_EVENT_TYPES =
  Object.freeze([
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
  ] as const);


export type TrustedEventType =
  (
    typeof TRUSTED_EVENT_TYPES
  )[number];


export interface EventStreamFrame {
  /**
   * Named SSE event type observed from the qualified server
   * event vocabulary.
   */
  readonly eventType:
    TrustedEventType;

  /**
   * Canonical positive SSE id.
   *
   * This is transport-envelope data only. N16.2e does not
   * adjudicate it against the JSON payload's event_seq.
   */
  readonly eventId:
    number;

  /**
   * Unparsed SSE data field.
   *
   * Trusted-event JSON parsing and validation belong to the
   * next ingestion layer.
   */
  readonly data:
    string;
}


export type EventStreamProtocolErrorCode =
  | "invalid_event_id"
  | "invalid_event_data"
  | "unexpected_unnamed_event";


export interface EventStreamHandlers {
  readonly onOpen?:
    () => void;

  readonly onFrame:
    (
      frame:
        EventStreamFrame,
    ) => void;

  /**
   * Transport connectivity observation only.
   *
   * A disconnect is not a trusted execution failure.
   */
  readonly onDisconnect?:
    () => void;

  /**
   * SSE envelope failure only.
   *
   * This does not manufacture a trusted orchestrator event.
   */
  readonly onProtocolError?:
    (
      code:
        EventStreamProtocolErrorCode,
    ) => void;
}


export interface EventStreamSource {
  addEventListener(
    type:
      string,

    listener:
      (
        event:
          Event,
      ) => void,
  ): void;

  close():
    void;
}


export type EventStreamSourceFactory =
  (
    url:
      string,
  ) => EventStreamSource;


export interface EventStreamConnection {
  readonly url:
    string;

  readonly close:
    () => void;

  readonly isClosed:
    () => boolean;
}


function createBrowserEventStreamSource(
  url:
    string,
): EventStreamSource {
  const source =
    new EventSource(
      url,
    );

  return {
    addEventListener(
      type:
        string,

      listener:
        (
          event:
            Event,
        ) => void,
    ): void {
      source.addEventListener(
        type,
        listener,
      );
    },

    close():
      void {
      source.close();
    },
  };
}


function parseCanonicalPositiveEventId(
  value:
    unknown,
): number | null {
  if (
    typeof value !== "string"
    || !/^[1-9][0-9]*$/.test(
      value,
    )
  ) {
    return null;
  }

  const parsed =
    Number(
      value,
    );

  if (
    !Number.isSafeInteger(
      parsed,
    )
    || parsed <= 0
    || String(
      parsed,
    ) !== value
  ) {
    return null;
  }

  return parsed;
}


function assertEventCursor(
  afterEventSeq:
    number,
): void {
  if (
    !Number.isSafeInteger(
      afterEventSeq,
    )
    || afterEventSeq < 0
  ) {
    throw new TypeError(
      "afterEventSeq must be a safe non-negative integer",
    );
  }
}


export function buildEventStreamUrl(
  afterEventSeq:
    number,
): string {
  assertEventCursor(
    afterEventSeq,
  );

  return (
    "/api/v1/events/stream"
    + "?after_event_seq="
    + String(
      afterEventSeq,
    )
  );
}


export function openEventStream(
  afterEventSeq:
    number,

  handlers:
    EventStreamHandlers,

  createSource:
    EventStreamSourceFactory =
      createBrowserEventStreamSource,
): EventStreamConnection {
  const url =
    buildEventStreamUrl(
      afterEventSeq,
    );

  const source =
    createSource(
      url,
    );

  let closed =
    false;


  const close = ():
    void => {
    if (closed) {
      return;
    }

    closed =
      true;

    source.close();
  };


  const protocolFailure = (
    code:
      EventStreamProtocolErrorCode,
  ): void => {
    if (closed) {
      return;
    }

    close();

    handlers
      .onProtocolError
      ?.(
        code,
      );
  };


  source.addEventListener(
    "open",
    () => {
      if (closed) {
        return;
      }

      handlers
        .onOpen
        ?.();
    },
  );


  /*
   * Native EventSource automatically reconnects after many
   * transport failures.
   *
   * That behavior is deliberately suppressed here by closing
   * the source immediately. A later layer will own explicit
   * reconnect policy using an updated event cursor.
   */
  source.addEventListener(
    "error",
    () => {
      if (closed) {
        return;
      }

      close();

      handlers
        .onDisconnect
        ?.();
    },
  );


  /*
   * The qualified server emits named events. An unnamed
   * "message" event violates that transport contract.
   */
  source.addEventListener(
    "message",
    () => {
      protocolFailure(
        "unexpected_unnamed_event",
      );
    },
  );


  for (
    const eventType
    of TRUSTED_EVENT_TYPES
  ) {
    source.addEventListener(
      eventType,
      (
        event:
          Event,
      ) => {
        if (closed) {
          return;
        }

        const candidate =
          event as {
            readonly lastEventId?:
              unknown;

            readonly data?:
              unknown;
          };

        const eventId =
          parseCanonicalPositiveEventId(
            candidate.lastEventId,
          );

        if (
          eventId === null
        ) {
          protocolFailure(
            "invalid_event_id",
          );

          return;
        }

        if (
          typeof candidate.data
          !== "string"
        ) {
          protocolFailure(
            "invalid_event_data",
          );

          return;
        }

        const frame:
          EventStreamFrame =
            Object.freeze({
              eventType,
              eventId,
              data:
                candidate.data,
            });

        handlers.onFrame(
          frame,
        );
      },
    );
  }


  return Object.freeze({
    url,

    close,

    isClosed:
      () => closed,
  });
}
