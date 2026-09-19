import type {
  EventPageResponse,
} from "../api/eventPage";

import type {
  OrchestratorEvent,
} from "../api/schemas";


export const GAP_REPAIR_BATCH_LIMIT =
  100;


export interface GapRepairPlan {
  readonly cursor:
    number;

  readonly observedEventSeq:
    number;

  readonly missingFromEventSeq:
    number;

  readonly missingThroughEventSeq:
    number;

  readonly requestAfterEventSeq:
    number;

  readonly requestLimit:
    number;

  readonly batchThroughEventSeq:
    number;
}


export type GapRepairIncompleteReason =
  | "empty_page"
  | "incomplete_page"
  | "sequence_gap";


export type GapRepairEvaluation =
  | {
      readonly kind:
        "batch_complete";

      readonly evidence:
        readonly OrchestratorEvent[];

      readonly contiguousThroughEventSeq:
        number;

      readonly targetMissingThroughEventSeq:
        number;

      readonly liveObservedEventSeq:
        number;
    }
  | {
      readonly kind:
        "incomplete";

      readonly reason:
        GapRepairIncompleteReason;

      readonly evidence:
        readonly OrchestratorEvent[];

      readonly contiguousThroughEventSeq:
        number;

      readonly expectedEventSeq:
        number;

      readonly observedEventSeq:
        number | null;

      readonly targetMissingThroughEventSeq:
        number;

      readonly liveObservedEventSeq:
        number;
    };


function assertSafeNonNegativeInteger(
  value:
    number,

  name:
    string,
): void {
  if (
    !Number.isSafeInteger(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${name} must be a safe non-negative integer`,
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


function immutableEvidence(
  events:
    readonly OrchestratorEvent[],
): readonly OrchestratorEvent[] {
  return deepFreeze(
    structuredClone(
      events,
    ),
  );
}


export function planGapRepair(
  cursor:
    number,

  observedEventSeq:
    number,
): GapRepairPlan {
  assertSafeNonNegativeInteger(
    cursor,
    "cursor",
  );

  assertSafeNonNegativeInteger(
    observedEventSeq,
    "observedEventSeq",
  );


  if (
    observedEventSeq
    <= cursor + 1
  ) {
    throw new TypeError(
      "gap repair requires an observed sequence beyond cursor + 1",
    );
  }


  const missingFromEventSeq =
    cursor + 1;

  const missingThroughEventSeq =
    observedEventSeq - 1;

  const missingCount =
    missingThroughEventSeq
    - missingFromEventSeq
    + 1;

  const requestLimit =
    Math.min(
      missingCount,
      GAP_REPAIR_BATCH_LIMIT,
    );

  const batchThroughEventSeq =
    cursor
    + requestLimit;


  return Object.freeze({
    cursor,

    observedEventSeq,

    missingFromEventSeq,

    missingThroughEventSeq,

    requestAfterEventSeq:
      cursor,

    requestLimit,

    batchThroughEventSeq,
  });
}


export function evaluateGapRepairPage(
  plan:
    GapRepairPlan,

  page:
    EventPageResponse,
): GapRepairEvaluation {
  if (
    page.after_event_seq
    !== plan.requestAfterEventSeq
  ) {
    throw new TypeError(
      "event page does not belong to this gap-repair plan",
    );
  }


  if (
    page.count
    > plan.requestLimit
  ) {
    throw new TypeError(
      "event page exceeds the gap-repair request limit",
    );
  }


  if (
    page.events.length === 0
  ) {
    return Object.freeze({
      kind:
        "incomplete",

      reason:
        "empty_page",

      evidence:
        Object.freeze(
          [],
        ),

      contiguousThroughEventSeq:
        plan.cursor,

      expectedEventSeq:
        plan.missingFromEventSeq,

      observedEventSeq:
        null,

      targetMissingThroughEventSeq:
        plan.missingThroughEventSeq,

      liveObservedEventSeq:
        plan.observedEventSeq,
    });
  }


  let expectedEventSeq =
    plan.missingFromEventSeq;

  const contiguous:
    OrchestratorEvent[] = [];


  for (
    const event
    of page.events
  ) {
    if (
      event.event_seq
      !== expectedEventSeq
    ) {
      return Object.freeze({
        kind:
          "incomplete",

        reason:
          "sequence_gap",

        evidence:
          immutableEvidence(
            contiguous,
          ),

        contiguousThroughEventSeq:
          expectedEventSeq - 1,

        expectedEventSeq,

        observedEventSeq:
          event.event_seq,

        targetMissingThroughEventSeq:
          plan.missingThroughEventSeq,

        liveObservedEventSeq:
          plan.observedEventSeq,
      });
    }


    contiguous.push(
      event,
    );

    expectedEventSeq += 1;
  }


  const contiguousThroughEventSeq =
    expectedEventSeq - 1;

  const evidence =
    immutableEvidence(
      contiguous,
    );


  if (
    contiguousThroughEventSeq
    === plan.batchThroughEventSeq
  ) {
    return Object.freeze({
      kind:
        "batch_complete",

      evidence,

      contiguousThroughEventSeq,

      targetMissingThroughEventSeq:
        plan.missingThroughEventSeq,

      liveObservedEventSeq:
        plan.observedEventSeq,
    });
  }


  return Object.freeze({
    kind:
      "incomplete",

    reason:
      "incomplete_page",

    evidence,

    contiguousThroughEventSeq,

    expectedEventSeq,

    observedEventSeq:
      null,

    targetMissingThroughEventSeq:
      plan.missingThroughEventSeq,

    liveObservedEventSeq:
      plan.observedEventSeq,
  });
}
