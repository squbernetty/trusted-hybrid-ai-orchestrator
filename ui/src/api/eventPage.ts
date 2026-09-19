import {
  parseOrchestratorEvent,
  type OrchestratorEvent,
} from "./schemas";


export interface EventPageResponse {
  readonly events:
    readonly OrchestratorEvent[];

  readonly count:
    number;

  readonly after_event_seq:
    number;

  readonly next_after_event_seq:
    number;
}


function isRecord(
  value:
    unknown,
): value is Record<
  string,
  unknown
> {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(
      value,
    )
  );
}


function requireSafeNonNegativeInteger(
  value:
    unknown,

  fieldName:
    string,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${fieldName} must be a safe non-negative integer`,
    );
  }

  return value;
}


function assertRequestedLimit(
  requestedLimit:
    number,
): void {
  if (
    !Number.isSafeInteger(
      requestedLimit,
    )
    || requestedLimit < 1
    || requestedLimit > 1000
  ) {
    throw new TypeError(
      "requestedLimit must be an integer between 1 and 1000",
    );
  }
}


function assertExactEnvelopeKeys(
  value:
    Record<
      string,
      unknown
    >,
): void {
  const expected = [
    "after_event_seq",
    "count",
    "events",
    "next_after_event_seq",
  ];

  const actual =
    Object.keys(
      value,
    ).sort();

  if (
    actual.length
      !== expected.length
    || actual.some(
      (
        key,
        index,
      ) => (
        key
        !== expected[index]
      ),
    )
  ) {
    throw new TypeError(
      "event page contains an unexpected envelope shape",
    );
  }
}


function deepFreeze<T>(
  value:
    T,
): T {
  if (
    value !== null
    && typeof value === "object"
    && !Object.isFrozen(
      value,
    )
  ) {
    for (
      const child
      of Object.values(
        value as Record<
          string,
          unknown
        >,
      )
    ) {
      deepFreeze(
        child,
      );
    }

    Object.freeze(
      value,
    );
  }

  return value;
}


function ownImmutableEvent(
  event:
    OrchestratorEvent,
): OrchestratorEvent {
  return deepFreeze(
    structuredClone(
      event,
    ),
  );
}


export function parseEventPageResponse(
  value:
    unknown,

  expectedAfterEventSeq:
    number,

  requestedLimit:
    number,
): EventPageResponse {
  requireSafeNonNegativeInteger(
    expectedAfterEventSeq,
    "expectedAfterEventSeq",
  );

  assertRequestedLimit(
    requestedLimit,
  );


  if (
    !isRecord(
      value,
    )
  ) {
    throw new TypeError(
      "event page must be an object",
    );
  }


  assertExactEnvelopeKeys(
    value,
  );


  if (
    !Array.isArray(
      value.events,
    )
  ) {
    throw new TypeError(
      "events must be an array",
    );
  }


  const count =
    requireSafeNonNegativeInteger(
      value.count,
      "count",
    );

  const afterEventSeq =
    requireSafeNonNegativeInteger(
      value.after_event_seq,
      "after_event_seq",
    );

  const nextAfterEventSeq =
    requireSafeNonNegativeInteger(
      value.next_after_event_seq,
      "next_after_event_seq",
    );


  if (
    afterEventSeq
    !== expectedAfterEventSeq
  ) {
    throw new TypeError(
      "event page cursor does not match the requested cursor",
    );
  }


  if (
    count
    !== value.events.length
  ) {
    throw new TypeError(
      "event page count does not match events length",
    );
  }


  if (
    count > requestedLimit
  ) {
    throw new TypeError(
      "event page exceeds the requested limit",
    );
  }


  const parsedEvents:
    OrchestratorEvent[] = [];

  let previousEventSeq =
    afterEventSeq;


  for (
    const candidate
    of value.events
  ) {
    const parsed =
      parseOrchestratorEvent(
        candidate,
      );

    if (
      parsed.event_seq
      <= previousEventSeq
    ) {
      throw new TypeError(
        "event page must contain strictly ascending events after the cursor",
      );
    }

    const owned =
      ownImmutableEvent(
        parsed,
      );

    parsedEvents.push(
      owned,
    );

    previousEventSeq =
      owned.event_seq;
  }


  const expectedNextCursor =
    parsedEvents.length > 0
      ? parsedEvents[
          parsedEvents.length - 1
        ].event_seq
      : afterEventSeq;


  if (
    nextAfterEventSeq
    !== expectedNextCursor
  ) {
    throw new TypeError(
      "next_after_event_seq does not match the observed page",
    );
  }


  const immutableEvents =
    Object.freeze(
      parsedEvents,
    );


  return Object.freeze({
    events:
      immutableEvents,

    count,

    after_event_seq:
      afterEventSeq,

    next_after_event_seq:
      nextAfterEventSeq,
  });
}
