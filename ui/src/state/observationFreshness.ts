export type ObservationFreshnessSource =
  | "health"
  | "tasks"
  | "eventTail";


export type ObservationFreshnessState =
  | "unobserved"
  | "fresh"
  | "stale";


export interface ObservationFreshnessPolicy {
  /**
   * Browser-local maximum receipt age.
   *
   * These thresholds are explicit policy. They are not supplied
   * by the orchestrator and do not imply trusted-state validity.
   */
  readonly healthMaxAgeMs:
    number;

  readonly tasksMaxAgeMs:
    number;

  readonly eventTailMaxAgeMs:
    number;
}


export type ObservationFreshnessClock =
  () => number;


export interface ObservationSourceFreshness {
  readonly state:
    ObservationFreshnessState;

  /**
   * Browser-local time at which this validated source was last
   * successfully observed.
   *
   * This is receipt metadata, not a server timestamp.
   */
  readonly lastObservedAtMs:
    number | null;

  readonly ageMs:
    number | null;

  readonly maxAgeMs:
    number;
}


export interface ObservationFreshnessSnapshot {
  readonly health:
    ObservationSourceFreshness;

  readonly tasks:
    ObservationSourceFreshness;

  /**
   * Freshness of the bootstrap event-tail snapshot only.
   *
   * This must not be interpreted as SSE liveness, event-stream
   * completeness, or trusted execution health.
   */
  readonly eventTail:
    ObservationSourceFreshness;
}


export interface ObservationFreshnessTracker {
  readonly markObserved:
    (
      source:
        ObservationFreshnessSource,
    ) => void;

  readonly getSnapshot:
    () => ObservationFreshnessSnapshot;

  readonly reset:
    () => void;
}


interface ReceiptTimes {
  readonly health:
    number | null;

  readonly tasks:
    number | null;

  readonly eventTail:
    number | null;
}


function assertNonnegativeFinite(
  value:
    unknown,

  field:
    string,
): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isFinite(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${field} must be a finite non-negative number`,
    );
  }
}


function ownPolicy(
  policy:
    ObservationFreshnessPolicy,
): ObservationFreshnessPolicy {
  if (
    typeof policy !== "object"
    || policy === null
    || Array.isArray(
      policy,
    )
  ) {
    throw new TypeError(
      "freshness policy must be an object",
    );
  }


  assertNonnegativeFinite(
    policy.healthMaxAgeMs,
    "healthMaxAgeMs",
  );

  assertNonnegativeFinite(
    policy.tasksMaxAgeMs,
    "tasksMaxAgeMs",
  );

  assertNonnegativeFinite(
    policy.eventTailMaxAgeMs,
    "eventTailMaxAgeMs",
  );


  return Object.freeze({
    healthMaxAgeMs:
      policy.healthMaxAgeMs,

    tasksMaxAgeMs:
      policy.tasksMaxAgeMs,

    eventTailMaxAgeMs:
      policy.eventTailMaxAgeMs,
  });
}


function initialReceiptTimes():
  ReceiptTimes {
  return Object.freeze({
    health:
      null,

    tasks:
      null,

    eventTail:
      null,
  });
}


function assertSource(
  source:
    unknown,
): asserts source is ObservationFreshnessSource {
  switch (source) {
    case "health":
    case "tasks":
    case "eventTail":
      return;

    default:
      throw new TypeError(
        "invalid observation freshness source",
      );
  }
}


function maxAgeFor(
  source:
    ObservationFreshnessSource,

  policy:
    ObservationFreshnessPolicy,
): number {
  switch (source) {
    case "health":
      return policy
        .healthMaxAgeMs;

    case "tasks":
      return policy
        .tasksMaxAgeMs;

    case "eventTail":
      return policy
        .eventTailMaxAgeMs;
  }
}


function sourceSnapshot(
  lastObservedAtMs:
    number | null,

  maxAgeMs:
    number,

  nowMs:
    number | null,
): ObservationSourceFreshness {
  if (
    lastObservedAtMs === null
  ) {
    return Object.freeze({
      state:
        "unobserved",

      lastObservedAtMs:
        null,

      ageMs:
        null,

      maxAgeMs,
    });
  }


  if (
    nowMs === null
  ) {
    throw new TypeError(
      "observed freshness requires a clock reading",
    );
  }


  const ageMs =
    nowMs
    - lastObservedAtMs;


  if (
    ageMs < 0
  ) {
    throw new RangeError(
      "freshness clock moved backwards",
    );
  }


  return Object.freeze({
    state:
      ageMs <= maxAgeMs
        ? "fresh"
        : "stale",

    lastObservedAtMs,

    ageMs,

    maxAgeMs,
  });
}


export function createObservationFreshnessTracker(
  policy:
    ObservationFreshnessPolicy,

  clock:
    ObservationFreshnessClock,
): ObservationFreshnessTracker {
  const ownedPolicy =
    ownPolicy(
      policy,
    );


  if (
    typeof clock !== "function"
  ) {
    throw new TypeError(
      "freshness clock must be a function",
    );
  }


  let receipts:
    ReceiptTimes =
      initialReceiptTimes();

  let lastClockReadMs:
    number | null =
      null;


  const readClock = ():
    number => {
    const nowMs =
      clock();


    assertNonnegativeFinite(
      nowMs,
      "freshness clock",
    );


    if (
      lastClockReadMs !== null
      && nowMs
        < lastClockReadMs
    ) {
      throw new RangeError(
        "freshness clock moved backwards",
      );
    }


    lastClockReadMs =
      nowMs;

    return nowMs;
  };


  const markObserved = (
    source:
      ObservationFreshnessSource,
  ): void => {
    assertSource(
      source,
    );


    const observedAtMs =
      readClock();


    receipts =
      Object.freeze({
        ...receipts,

        [source]:
          observedAtMs,
      });
  };


  const getSnapshot = ():
    ObservationFreshnessSnapshot => {
    const hasObservation =
      receipts.health !== null
      || receipts.tasks !== null
      || receipts.eventTail !== null;


    /*
     * An entirely unobserved tracker does not need to consult the
     * clock. This keeps "not yet observed" independent from clock
     * availability or passage of time.
     */
    const nowMs =
      hasObservation
        ? readClock()
        : null;


    return Object.freeze({
      health:
        sourceSnapshot(
          receipts.health,
          maxAgeFor(
            "health",
            ownedPolicy,
          ),
          nowMs,
        ),

      tasks:
        sourceSnapshot(
          receipts.tasks,
          maxAgeFor(
            "tasks",
            ownedPolicy,
          ),
          nowMs,
        ),

      eventTail:
        sourceSnapshot(
          receipts.eventTail,
          maxAgeFor(
            "eventTail",
            ownedPolicy,
          ),
          nowMs,
        ),
    });
  };


  const reset = ():
    void => {
    receipts =
      initialReceiptTimes();
  };


  return Object.freeze({
    markObserved,
    getSnapshot,
    reset,
  });
}
