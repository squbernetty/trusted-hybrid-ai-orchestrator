import {
  openEventStream,
  type EventStreamConnection,
  type EventStreamFrame,
  type EventStreamHandlers,
} from "../api/eventStream";

import type {
  OrchestratorEvent,
} from "../api/schemas";

import {
  executeGapRepairBatch,
  type GapRepairExecutionResult,
} from "./gapRepairExecutor";

import {
  reconcileEventFrame,
  reconcileValidatedEvent,
  type EventReconciliationResult,
  type ValidatedEventReconciliationResult,
} from "./eventReconciler";

import type {
  ObservationState,
  ObservationStore,
} from "./observationStore";


export const MAX_REPAIR_BATCHES_PER_GAP =
  10;


export type ObservationControllerState =
  | "idle"
  | "streaming"
  | "repairing"
  | "disconnected"
  | "degraded"
  | "stopped";


export interface ObservationControllerSnapshot {
  /**
   * Browser-local controller state.
   *
   * This is operational metadata only. It is not trusted
   * orchestrator state and is deliberately not stored in the
   * ObservationStore.
   */
  readonly state:
    ObservationControllerState;

  /**
   * Monotonic identifier assigned when a stream session is
   * opened.
   *
   * N16.2h5 creates later generations only through explicit
   * continuation. Repair retries themselves do not increment
   * this value; construction of a new SSE session does.
   */
  readonly sessionGeneration:
    number;

  /**
   * Sequence number of the live frame that exposed a gap.
   *
   * null means no unresolved retained gap frame is currently
   * held by the controller.
   */
  readonly retainedGapEventSeq:
    number | null;
}


export interface ObservationControllerDependencies {
  readonly openEventStream:
    (
      afterEventSeq:
        number,

      handlers:
        EventStreamHandlers,
    ) => EventStreamConnection;

  readonly reconcileEventFrame:
    (
      frame:
        EventStreamFrame,

      cursor:
        number,

      knownEvent?:
        OrchestratorEvent | null,
    ) => EventReconciliationResult;

  /**
   * Optional only to preserve the qualified dependency-isolated
   * N16.2h3 test path.
   *
   * Production defaults always provide both repair functions.
   * Custom dependencies must provide either both or neither.
   */
  readonly executeGapRepairBatch?:
    (
      cursor:
        number,

      observedEventSeq:
        number,

      signal?:
        AbortSignal,
    ) => Promise<
      GapRepairExecutionResult
    >;

  readonly reconcileValidatedEvent?:
    (
      event:
        OrchestratorEvent,

      cursor:
        number,

      knownEvent?:
        OrchestratorEvent | null,
    ) => ValidatedEventReconciliationResult;
}


export type ObservationControllerListener =
  () => void;


export interface ObservationController {
  readonly getSnapshot:
    () => ObservationControllerSnapshot;

  readonly subscribe:
    (
      listener:
        ObservationControllerListener,
    ) => () => void;

  readonly start:
    () => void;

  /**
   * Explicitly continue observation after transport loss or a
   * repair-read failure.
   *
   * No timer, retry loop, or automatic reconnect policy exists
   * in N16.2h5.
   */
  readonly continue:
    () => Promise<void>;

  readonly stop:
    () => void;
}


type RepairExecutor =
  NonNullable<
    ObservationControllerDependencies[
      "executeGapRepairBatch"
    ]
  >;


type ValidatedEventReconciler =
  NonNullable<
    ObservationControllerDependencies[
      "reconcileValidatedEvent"
    ]
  >;


const defaultDependencies:
  ObservationControllerDependencies =
    Object.freeze({
      openEventStream,

      reconcileEventFrame,

      executeGapRepairBatch,

      reconcileValidatedEvent,
    });


function findKnownEvent(
  state:
    ObservationState,

  eventSeq:
    number,
): OrchestratorEvent | null {
  const window =
    state
      .observed
      .eventWindow;

  for (
    let index =
      window.length - 1;

    index >= 0;

    index -= 1
  ) {
    const candidate =
      window[index];

    if (
      candidate.event_seq
      === eventSeq
    ) {
      return candidate;
    }
  }

  return null;
}


function ownFrame(
  frame:
    EventStreamFrame,
): EventStreamFrame {
  /*
   * EventStreamFrame contains only immutable scalar transport
   * envelope values. Own the retained copy anyway so a custom
   * transport dependency cannot mutate later repair evidence.
   */
  return Object.freeze({
    eventType:
      frame.eventType,

    eventId:
      frame.eventId,

    data:
      frame.data,
  });
}


export function createObservationController(
  store:
    ObservationStore,

  dependencies:
    ObservationControllerDependencies =
      defaultDependencies,
): ObservationController {
  /*
   * Repair is an all-or-none injected capability.
   *
   * This allows the historical N16.2h3 dependency-isolated
   * controller tests to remain valid without ever falling back
   * to real HTTP work.
   */
  if (
    (
      dependencies
        .executeGapRepairBatch
      === undefined
    )
    !==
    (
      dependencies
        .reconcileValidatedEvent
      === undefined
    )
  ) {
    throw new TypeError(
      "repair dependencies must be supplied together",
    );
  }


  let state:
    ObservationControllerState =
      "idle";

  let activeConnection:
    EventStreamConnection | null =
      null;

  let retainedGapFrame:
    EventStreamFrame | null =
      null;

  let repairAbortController:
    AbortController | null =
      null;

  let sessionGeneration =
    0;


  const listeners =
    new Set<
      ObservationControllerListener
    >();


  const subscribe = (
    listener:
      ObservationControllerListener,
  ): (() => void) => {
    listeners.add(
      listener,
    );

    let subscribed =
      true;

    return () => {
      if (!subscribed) {
        return;
      }

      subscribed =
        false;

      listeners.delete(
        listener,
      );
    };
  };


  let snapshot:
    ObservationControllerSnapshot =
      Object.freeze({
        state,

        sessionGeneration,

        retainedGapEventSeq:
          null,
      });


  const getSnapshot =
    (): ObservationControllerSnapshot => (
      snapshot
    );


  const publishSnapshotIfChanged = ():
    void => {
    const retainedGapEventSeq =
      retainedGapFrame
        ?.eventId
      ?? null;

    if (
      snapshot.state
        === state
      && snapshot.sessionGeneration
        === sessionGeneration
      && snapshot.retainedGapEventSeq
        === retainedGapEventSeq
    ) {
      return;
    }

    snapshot =
      Object.freeze({
        state,

        sessionGeneration,

        retainedGapEventSeq,
      });

    for (
      const listener
      of [...listeners]
    ) {
      try {
        listener();
      }
      catch {
        /*
         * Presentation observers are non-authoritative.
         * Their failure must not interrupt controller
         * lifecycle transitions.
         */
        continue;
      }
    }
  };


  const closeActiveConnection = ():
    void => {
    const connection =
      activeConnection;

    activeConnection =
      null;

    connection
      ?.close();
  };


  const terminateSession = (
    nextState:
      | "repairing"
      | "disconnected"
      | "degraded",

    gapFrame:
      EventStreamFrame | null =
        null,
  ): void => {
    /*
     * Change controller state before closing the transport.
     * Even a custom connection implementation that invokes a
     * callback synchronously from close() therefore observes a
     * non-streaming state and cannot re-enter ingestion.
     */
    state =
      nextState;

    retainedGapFrame =
      gapFrame === null
        ? null
        : ownFrame(
            gapFrame,
          );

    closeActiveConnection();

    publishSnapshotIfChanged();
  };


  const isCurrentStreamingSession = (
    generation:
      number,
  ): boolean => (
    generation
      === sessionGeneration
    && state
      === "streaming"
  );


  const isCurrentRepair = (
    generation:
      number,

    controller:
      AbortController,
  ): boolean => (
    generation
      === sessionGeneration
    && state
      === "repairing"
    && repairAbortController
      === controller
    && retainedGapFrame
      !== null
  );


  const finishRepair = (
    generation:
      number,

    controller:
      AbortController,

    nextState:
      | "disconnected"
      | "degraded"
      | "stopped",

    preserveGapFrame:
      boolean,
  ): void => {
    if (
      !isCurrentRepair(
        generation,
        controller,
      )
    ) {
      return;
    }

    state =
      nextState;

    if (
      !preserveGapFrame
    ) {
      retainedGapFrame =
        null;
    }

    repairAbortController =
      null;

    publishSnapshotIfChanged();
  };


  const getReconciliationContext = (
    eventSeq:
      number,
  ): {
    readonly cursor:
      number;

    readonly knownEvent:
      OrchestratorEvent | null;
  } => {
    const observedState =
      store.getSnapshot();

    const cursor =
      observedState
        .derived
        .currentEventCursor;

    if (
      cursor === null
    ) {
      throw new TypeError(
        "event reconciliation requires a validated event-tail baseline",
      );
    }

    return {
      cursor,

      knownEvent:
        findKnownEvent(
          observedState,
          eventSeq,
        ),
    };
  };


  const reconcileObservedFrame = (
    frame:
      EventStreamFrame,
  ): EventReconciliationResult => {
    const context =
      getReconciliationContext(
        frame.eventId,
      );

    return dependencies
      .reconcileEventFrame(
        frame,
        context.cursor,
        context.knownEvent,
      );
  };


  const applyAcceptedEvent = (
    event:
      OrchestratorEvent,
  ): void => {
    /*
     * This remains the controller's single store mutation site.
     *
     * ObservationStore independently enforces exact-next
     * sequencing and remains the sole authority that advances
     * currentEventCursor.
     */
    store.dispatch({
      type:
        "observation/event-accepted",

      event,
    });
  };


  const runGapRepair = async (
    generation:
      number,

    controller:
      AbortController,

    repairExecutor:
      RepairExecutor,

    validatedReconciler:
      ValidatedEventReconciler,
  ): Promise<void> => {
    const retainedFrame =
      retainedGapFrame;

    if (
      retainedFrame === null
      || !isCurrentRepair(
        generation,
        controller,
      )
    ) {
      return;
    }

    const liveObservedEventSeq =
      retainedFrame.eventId;

    const targetMissingThroughEventSeq =
      liveObservedEventSeq - 1;


    /*
     * Each invocation remains exactly one already-qualified
     * bounded repair batch. The controller is the only layer
     * that composes multiple batches.
     */
    for (
      let batchIndex = 0;

      batchIndex
        < MAX_REPAIR_BATCHES_PER_GAP;

      batchIndex += 1
    ) {
      if (
        !isCurrentRepair(
          generation,
          controller,
        )
      ) {
        return;
      }


      const currentCursor =
        store
          .getSnapshot()
          .derived
          .currentEventCursor;

      if (
        currentCursor === null
      ) {
        finishRepair(
          generation,
          controller,
          "degraded",
          true,
        );

        return;
      }


      /*
       * All missing events have been reconstructed. The retained
       * live frame itself is reconciled after this loop.
       */
      if (
        currentCursor
        === targetMissingThroughEventSeq
      ) {
        break;
      }


      if (
        currentCursor
        > targetMissingThroughEventSeq
      ) {
        finishRepair(
          generation,
          controller,
          "degraded",
          true,
        );

        return;
      }


      let execution:
        GapRepairExecutionResult;

      execution =
        await repairExecutor(
          currentCursor,
          liveObservedEventSeq,
          controller.signal,
        );


      if (
        !isCurrentRepair(
          generation,
          controller,
        )
      ) {
        return;
      }


      if (
        execution.outcome
        === "aborted"
      ) {
        finishRepair(
          generation,
          controller,
          "stopped",
          false,
        );

        return;
      }


      if (
        execution.outcome
        === "failed"
      ) {
        /*
         * Retrieval failure is connectivity state, not evidence
         * contradiction. Keep the retained gap frame so a later
         * explicit continuation policy can distinguish an
         * unresolved gap from a fully synchronized disconnect.
         */
        finishRepair(
          generation,
          controller,
          "disconnected",
          true,
        );

        return;
      }


      const evaluation =
        execution.evaluation;


      /*
       * No evidence from an incomplete batch is promoted.
       *
       * Even a contiguous prefix remains observational evidence
       * only until the already-qualified batch evaluator has
       * established batch_complete.
       */
      if (
        evaluation.kind
        !== "batch_complete"
      ) {
        finishRepair(
          generation,
          controller,
          "degraded",
          true,
        );

        return;
      }


      /*
       * Defensive composition checks.
       *
       * These values never advance the cursor. They only prove
       * that the batch result belongs to the repair operation
       * currently in progress.
       */
      if (
        execution.plan.cursor
          !== currentCursor
        || execution.plan.observedEventSeq
          !== liveObservedEventSeq
        || execution.plan.requestAfterEventSeq
          !== currentCursor
        || execution.plan.missingThroughEventSeq
          !== targetMissingThroughEventSeq
        || evaluation.liveObservedEventSeq
          !== liveObservedEventSeq
        || evaluation.targetMissingThroughEventSeq
          !== targetMissingThroughEventSeq
        || evaluation.contiguousThroughEventSeq
          <= currentCursor
        || evaluation.evidence.length
          !== (
            evaluation
              .contiguousThroughEventSeq
            - currentCursor
          )
      ) {
        finishRepair(
          generation,
          controller,
          "degraded",
          true,
        );

        return;
      }


      /*
       * Promote each repaired event individually:
       *
       * HTTP validation
       *   -> gap evaluator batch_complete
       *   -> validated-event reconciliation
       *   -> exact-next ObservationStore transition
       *
       * Page metadata and batch metadata never mutate the cursor.
       */
      for (
        const event
        of evaluation.evidence
      ) {
        if (
          !isCurrentRepair(
            generation,
            controller,
          )
        ) {
          return;
        }


        const context =
          getReconciliationContext(
            event.event_seq,
          );

        const reconciled =
          validatedReconciler(
            event,
            context.cursor,
            context.knownEvent,
          );


        if (
          reconciled.kind
          !== "accepted"
        ) {
          finishRepair(
            generation,
            controller,
            "degraded",
            true,
          );

          return;
        }


        if (
          reconciled.previousCursor
            !== context.cursor
          || reconciled.nextCursor
            !== event.event_seq
        ) {
          finishRepair(
            generation,
            controller,
            "degraded",
            true,
          );

          return;
        }


        applyAcceptedEvent(
          reconciled.event,
        );


        const advancedCursor =
          store
            .getSnapshot()
            .derived
            .currentEventCursor;

        if (
          advancedCursor
          !== reconciled.nextCursor
        ) {
          finishRepair(
            generation,
            controller,
            "degraded",
            true,
          );

          return;
        }
      }


      const batchCursor =
        store
          .getSnapshot()
          .derived
          .currentEventCursor;

      if (
        batchCursor
        !== evaluation
          .contiguousThroughEventSeq
      ) {
        finishRepair(
          generation,
          controller,
          "degraded",
          true,
        );

        return;
      }
    }


    if (
      !isCurrentRepair(
        generation,
        controller,
      )
    ) {
      return;
    }


    const repairedCursor =
      store
        .getSnapshot()
        .derived
        .currentEventCursor;

    /*
     * Exiting the bounded loop without reaching the event before
     * the retained live frame means the automatic-repair safety
     * bound has been exhausted.
     */
    if (
      repairedCursor
      !== targetMissingThroughEventSeq
    ) {
      finishRepair(
        generation,
        controller,
        "degraded",
        true,
      );

      return;
    }


    /*
     * Re-run the retained SSE frame through the qualified frame
     * reconciliation boundary.
     *
     * Its JSON/schema/envelope contract is therefore checked
     * again against the newly reconstructed cursor.
     */
    const retainedResult =
      reconcileObservedFrame(
        retainedFrame,
      );


    if (
      retainedResult.kind
      !== "accepted"
    ) {
      finishRepair(
        generation,
        controller,
        "degraded",
        true,
      );

      return;
    }


    applyAcceptedEvent(
      retainedResult.event,
    );


    const completedCursor =
      store
        .getSnapshot()
        .derived
        .currentEventCursor;

    if (
      completedCursor
      !== liveObservedEventSeq
    ) {
      finishRepair(
        generation,
        controller,
        "degraded",
        true,
      );

      return;
    }


    /*
     * Repair itself never creates a new SSE session.
     *
     * The browser is synchronized through the retained live
     * event and currently has no active transport. N16.2h5 may
     * subsequently open a new generation only from an explicit
     * continue() operation.
     */
    finishRepair(
      generation,
      controller,
      "disconnected",
      false,
    );
  };


  const beginGapRepair = (
    generation:
      number,
  ): void => {
    const repairExecutor =
      dependencies
        .executeGapRepairBatch;

    const validatedReconciler =
      dependencies
        .reconcileValidatedEvent;


    /*
     * Both absent is the dependency-isolated N16.2h3 mode.
     * Production defaults always provide both.
     */
    if (
      repairExecutor === undefined
      && validatedReconciler === undefined
    ) {
      return;
    }


    if (
      repairExecutor === undefined
      || validatedReconciler === undefined
    ) {
      state =
        "degraded";

      publishSnapshotIfChanged();

      return;
    }


    const controller =
      new AbortController();

    repairAbortController =
      controller;


    /*
     * EventStreamHandlers are synchronous by contract. Repair is
     * deliberately launched as controller-private asynchronous
     * work after the live stream has already been closed.
     */
    void runGapRepair(
      generation,
      controller,
      repairExecutor,
      validatedReconciler,
    ).catch(
      () => {
        /*
         * Evaluator contract faults, unexpected reconciler
         * faults, and store transition faults are integrity
         * failures rather than connectivity failures.
         *
         * A stop or superseding operation makes this async
         * completion stale and therefore inert.
         */
        finishRepair(
          generation,
          controller,
          "degraded",
          true,
        );
      },
    );
  };


  const handleFrame = (
    generation:
      number,

    frame:
      EventStreamFrame,
  ): void => {
    if (
      !isCurrentStreamingSession(
        generation,
      )
    ) {
      return;
    }


    let result:
      EventReconciliationResult;

    try {
      result =
        reconcileObservedFrame(
          frame,
        );
    }
    catch {
      terminateSession(
        "degraded",
      );

      return;
    }


    if (
      !isCurrentStreamingSession(
        generation,
      )
    ) {
      return;
    }


    switch (result.kind) {
      case "accepted":
        try {
          applyAcceptedEvent(
            result.event,
          );
        }
        catch {
          terminateSession(
            "degraded",
          );
        }

        return;


      case "duplicate":
      case "replay":
        /*
         * Observationally valid but already behind/equal to the
         * verified cursor. Neither classification may mutate the
         * store or cursor.
         */
        return;


      case "gap":
        /*
         * Live SSE is closed before asynchronous repair begins.
         * There is therefore never a live stream and a repair
         * retrieval operating concurrently.
         */
        terminateSession(
          "repairing",
          frame,
        );

        beginGapRepair(
          generation,
        );

        return;


      case "contradiction":
      case "rejected":
        terminateSession(
          "degraded",
        );

        return;
    }
  };


  const openStreamSession = ():
    void => {
    const cursor =
      store
        .getSnapshot()
        .derived
        .currentEventCursor;

    if (
      cursor === null
    ) {
      throw new TypeError(
        "observation controller requires a validated event-tail baseline",
      );
    }


    sessionGeneration +=
      1;

    const generation =
      sessionGeneration;


    /*
     * "streaming" includes the short browser-local interval in
     * which the one-shot SSE connection is being constructed.
     */
    state =
      "streaming";

    retainedGapFrame =
      null;

    publishSnapshotIfChanged();

    /*
     * A subscriber may synchronously invoke stop().
     * Never create a transport after the published generation
     * is no longer the current streaming session.
     */
    if (
      !isCurrentStreamingSession(
        generation,
      )
    ) {
      return;
    }


    const handlers:
      EventStreamHandlers =
        Object.freeze({
          onFrame(
            frame:
              EventStreamFrame,
          ): void {
            handleFrame(
              generation,
              frame,
            );
          },

          onDisconnect():
            void {
            if (
              !isCurrentStreamingSession(
                generation,
              )
            ) {
              return;
            }

            terminateSession(
              "disconnected",
            );
          },

          onProtocolError():
            void {
            if (
              !isCurrentStreamingSession(
                generation,
              )
            ) {
              return;
            }

            terminateSession(
              "degraded",
            );
          },
        });


    let connection:
      EventStreamConnection;

    try {
      connection =
        dependencies
          .openEventStream(
            cursor,
            handlers,
          );
    }
    catch (error) {
      if (
        generation
          === sessionGeneration
        && state
          === "streaming"
      ) {
        state =
          "disconnected";

        retainedGapFrame =
          null;

        activeConnection =
          null;

        publishSnapshotIfChanged();
      }

      throw error;
    }


    /*
     * A custom dependency can invoke handlers synchronously
     * while openEventStream() is constructing the connection.
     * If such a callback already terminated the session, close
     * the newly returned connection instead of publishing it as
     * active.
     */
    if (
      !isCurrentStreamingSession(
        generation,
      )
    ) {
      connection.close();

      return;
    }


    activeConnection =
      connection;
  };


  const start = ():
    void => {
    if (
      state !== "idle"
    ) {
      throw new TypeError(
        "observation controller can only start from idle",
      );
    }

    openStreamSession();
  };


  const continueObservation = async ():
    Promise<void> => {
    /*
     * Continuation is explicit and legal only from transport
     * disconnection.
     *
     * Integrity failure (degraded), active streaming/repair,
     * initial idle state, and terminal stop cannot be bypassed
     * through this operation.
     */
    if (
      state !== "disconnected"
    ) {
      throw new TypeError(
        "observation controller can only continue from disconnected",
      );
    }


    /*
     * A clean disconnect has no unresolved gap identity.
     *
     * Open the next stream generation directly from the verified
     * ObservationStore cursor.
     */
    if (
      retainedGapFrame === null
    ) {
      openStreamSession();

      return;
    }


    /*
     * A retained frame means a prior repair retrieval failed.
     *
     * Do not reopen SSE over an unresolved evidence gap. Resume
     * the repair first using the current session generation.
     */
    const repairExecutor =
      dependencies
        .executeGapRepairBatch;

    const validatedReconciler =
      dependencies
        .reconcileValidatedEvent;


    if (
      repairExecutor === undefined
      || validatedReconciler === undefined
    ) {
      state =
        "degraded";

      publishSnapshotIfChanged();

      return;
    }


    const generation =
      sessionGeneration;

    const controller =
      new AbortController();


    state =
      "repairing";

    repairAbortController =
      controller;

    publishSnapshotIfChanged();


    try {
      await runGapRepair(
        generation,
        controller,
        repairExecutor,
        validatedReconciler,
      );
    }
    catch {
      /*
       * Match the already-qualified live-gap repair policy:
       * unexpected repair/reconciliation/store faults are
       * integrity failures.
       */
      finishRepair(
        generation,
        controller,
        "degraded",
        true,
      );

      return;
    }


    /*
     * A stop, integrity failure, repeated read failure, or other
     * stale completion must never create a replacement stream.
     *
     * Only complete repair produces:
     *
     *   disconnected
     *   retainedGapFrame === null
     *   same generation
     *
     * At that point the explicit continue() operation may create
     * the next generation from the store's newly verified cursor.
     */
    /*
     * Re-read lifecycle state after the awaited repair.
     *
     * runGapRepair() may transition controller-private state via
     * finishRepair(). Using a fresh snapshot both expresses that
     * asynchronous boundary explicitly and avoids relying on
     * TypeScript to infer indirect closure mutation.
     */
    const settled =
      getSnapshot();


    if (
      generation
        !== settled
          .sessionGeneration
      || settled.state
        !== "disconnected"
      || settled
          .retainedGapEventSeq
        !== null
    ) {
      return;
    }


    openStreamSession();
  };


  const stop = ():
    void => {
    if (
      state === "stopped"
    ) {
      return;
    }


    /*
     * Terminal state is established before transport close or
     * repair cancellation so all resulting async/callback work
     * is stale before it can observe cancellation.
     */
    state =
      "stopped";

    retainedGapFrame =
      null;

    closeActiveConnection();


    const controller =
      repairAbortController;

    repairAbortController =
      null;

    publishSnapshotIfChanged();

    controller
      ?.abort();
  };


  return Object.freeze({
    getSnapshot,
    subscribe,
    start,

    continue:
      continueObservation,

    stop,
  });
}
