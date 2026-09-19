import {
  parseOrchestratorEvent,
  type OrchestratorEvent,
} from "../api/schemas";

import type {
  EventStreamFrame,
} from "../api/eventStream";


export type EventRejectionReason =
  | "invalid_json"
  | "invalid_event"
  | "event_type_mismatch"
  | "event_seq_mismatch";


export type EventContradictionReason =
  | "sequence_collision";


export type EventReconciliationResult =
  | {
      readonly kind:
        "accepted";

      readonly event:
        OrchestratorEvent;

      readonly previousCursor:
        number;

      readonly nextCursor:
        number;
    }
  | {
      readonly kind:
        "duplicate";

      readonly event:
        OrchestratorEvent;

      readonly cursor:
        number;
    }
  | {
      readonly kind:
        "replay";

      readonly event:
        OrchestratorEvent;

      readonly cursor:
        number;
    }
  | {
      readonly kind:
        "gap";

      readonly event:
        OrchestratorEvent;

      readonly cursor:
        number;

      readonly expectedEventSeq:
        number;

      readonly observedEventSeq:
        number;
    }
  | {
      readonly kind:
        "contradiction";

      readonly event:
        OrchestratorEvent;

      readonly knownEvent:
        OrchestratorEvent;

      readonly cursor:
        number;

      readonly reason:
        EventContradictionReason;
    }
  | {
      readonly kind:
        "rejected";

      readonly cursor:
        number;

      readonly reason:
        EventRejectionReason;
    };


export type ValidatedEventReconciliationResult =
  Exclude<
    EventReconciliationResult,
    {
      readonly kind:
        "rejected";
    }
  >;


function assertCursor(
  cursor:
    number,
): void {
  if (
    !Number.isSafeInteger(
      cursor,
    )
    || cursor < 0
  ) {
    throw new TypeError(
      "cursor must be a safe non-negative integer",
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


function jsonValuesEqual(
  left:
    unknown,

  right:
    unknown,
): boolean {
  if (
    Object.is(
      left,
      right,
    )
  ) {
    return true;
  }

  if (
    left === null
    || right === null
  ) {
    return false;
  }

  if (
    typeof left !== "object"
    || typeof right !== "object"
  ) {
    return false;
  }

  if (
    Array.isArray(
      left,
    )
    || Array.isArray(
      right,
    )
  ) {
    if (
      !Array.isArray(
        left,
      )
      || !Array.isArray(
        right,
      )
      || left.length
        !== right.length
    ) {
      return false;
    }

    for (
      let index = 0;
      index < left.length;
      index += 1
    ) {
      if (
        !jsonValuesEqual(
          left[index],
          right[index],
        )
      ) {
        return false;
      }
    }

    return true;
  }

  const leftObject =
    left as Record<
      string,
      unknown
    >;

  const rightObject =
    right as Record<
      string,
      unknown
    >;

  const leftKeys =
    Object.keys(
      leftObject,
    ).sort();

  const rightKeys =
    Object.keys(
      rightObject,
    ).sort();

  if (
    leftKeys.length
    !== rightKeys.length
  ) {
    return false;
  }

  for (
    let index = 0;
    index < leftKeys.length;
    index += 1
  ) {
    if (
      leftKeys[index]
      !== rightKeys[index]
    ) {
      return false;
    }

    const key =
      leftKeys[index];

    if (
      !jsonValuesEqual(
        leftObject[key],
        rightObject[key],
      )
    ) {
      return false;
    }
  }

  return true;
}


function stringArraysEqual(
  left:
    readonly string[],

  right:
    readonly string[],
): boolean {
  if (
    left.length
    !== right.length
  ) {
    return false;
  }

  return left.every(
    (
      value,
      index,
    ) => (
      value
      === right[index]
    ),
  );
}


export function orchestratorEventsEquivalent(
  left:
    OrchestratorEvent,

  right:
    OrchestratorEvent,
): boolean {
  return (
    left.schema_version
      === right.schema_version
    && left.event_seq
      === right.event_seq
    && left.event_id
      === right.event_id
    && left.event_type
      === right.event_type
    && left.occurred_at
      === right.occurred_at
    && left.source_class
      === right.source_class
    && left.component
      === right.component
    && left.task_id
      === right.task_id
    && left.execution_id
      === right.execution_id
    && left.parent_execution_id
      === right.parent_execution_id
    && left.request_id
      === right.request_id
    && left.worker_role
      === right.worker_role
    && left.provider_id
      === right.provider_id
    && left.model_id
      === right.model_id
    && left.state_before
      === right.state_before
    && left.state_after
      === right.state_after
    && left.reason_code
      === right.reason_code
    && stringArraysEqual(
      left.evidence_refs,
      right.evidence_refs,
    )
    && jsonValuesEqual(
      left.payload,
      right.payload,
    )
  );
}


function rejected(
  cursor:
    number,

  reason:
    EventRejectionReason,
): EventReconciliationResult {
  return Object.freeze({
    kind:
      "rejected",

    cursor,

    reason,
  });
}


export function reconcileValidatedEvent(
  event:
    OrchestratorEvent,

  cursor:
    number,

  knownEvent:
    OrchestratorEvent | null =
      null,
): ValidatedEventReconciliationResult {
  assertCursor(
    cursor,
  );


  /*
   * The caller supplies an already structurally validated
   * OrchestratorEvent.
   *
   * This function owns only event ownership plus sequence /
   * retained-evidence reconciliation. It deliberately knows
   * nothing about SSE frames, JSON, HTTP, transport, repair,
   * stores, timers, or presentation.
   */
  const ownedEvent =
    ownImmutableEvent(
      event,
    );


  /*
   * Preserve the qualified N16.2f retained-evidence semantics.
   *
   * The wording remains unchanged so reconcileEventFrame()
   * retains its prior externally observable failure behavior.
   */
  if (
    knownEvent !== null
    && knownEvent.event_seq
      !== ownedEvent.event_seq
  ) {
    throw new TypeError(
      "knownEvent must have the same event_seq as the observed frame",
    );
  }


  if (
    knownEvent !== null
    && knownEvent.event_seq
      > cursor
  ) {
    throw new TypeError(
      "knownEvent cannot be ahead of the reconciliation cursor",
    );
  }


  if (
    ownedEvent.event_seq
    === cursor + 1
  ) {
    return Object.freeze({
      kind:
        "accepted",

      event:
        ownedEvent,

      previousCursor:
        cursor,

      nextCursor:
        ownedEvent.event_seq,
    });
  }


  if (
    ownedEvent.event_seq
    > cursor + 1
  ) {
    return Object.freeze({
      kind:
        "gap",

      event:
        ownedEvent,

      cursor,

      expectedEventSeq:
        cursor + 1,

      observedEventSeq:
        ownedEvent.event_seq,
    });
  }


  /*
   * event_seq <= cursor
   *
   * Retained evidence is required to distinguish a proven
   * duplicate from a replay or sequence collision.
   */
  if (
    knownEvent === null
  ) {
    return Object.freeze({
      kind:
        "replay",

      event:
        ownedEvent,

      cursor,
    });
  }


  if (
    orchestratorEventsEquivalent(
      ownedEvent,
      knownEvent,
    )
  ) {
    return Object.freeze({
      kind:
        "duplicate",

      event:
        ownedEvent,

      cursor,
    });
  }


  return Object.freeze({
    kind:
      "contradiction",

    event:
      ownedEvent,

    knownEvent:
      ownImmutableEvent(
        knownEvent,
      ),

    cursor,

    reason:
      "sequence_collision",
  });
}


export function reconcileEventFrame(
  frame:
    EventStreamFrame,

  cursor:
    number,

  knownEvent:
    OrchestratorEvent | null =
      null,
): EventReconciliationResult {
  /*
   * Preserve N16.2f ordering:
   *
   * invalid cursor remains programmer error before any attempt
   * to decode or classify frame content.
   */
  assertCursor(
    cursor,
  );


  let decoded:
    unknown;

  try {
    decoded =
      JSON.parse(
        frame.data,
      ) as unknown;
  }
  catch {
    return rejected(
      cursor,
      "invalid_json",
    );
  }


  let parsed:
    OrchestratorEvent;

  try {
    parsed =
      parseOrchestratorEvent(
        decoded,
      );
  }
  catch {
    return rejected(
      cursor,
      "invalid_event",
    );
  }


  if (
    parsed.event_type
    !== frame.eventType
  ) {
    return rejected(
      cursor,
      "event_type_mismatch",
    );
  }


  if (
    parsed.event_seq
    !== frame.eventId
  ) {
    return rejected(
      cursor,
      "event_seq_mismatch",
    );
  }


  /*
   * Once the SSE-specific envelope has been validated, both
   * live SSE evidence and already-validated HTTP evidence use
   * the same sequence/equivalence reconciliation core.
   */
  return reconcileValidatedEvent(
    parsed,
    cursor,
    knownEvent,
  );
}
