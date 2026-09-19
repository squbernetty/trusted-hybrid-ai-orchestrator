import type {
  BootstrapResult,
} from "../state/bootstrapCoordinator";

import {
  createObservationController,
  type ObservationController,
  type ObservationControllerListener,
  type ObservationControllerSnapshot,
} from "../state/observationController";

import {
  createObservationFreshnessTracker,
  type ObservationFreshnessPolicy,
} from "../state/observationFreshness";

import {
  createObservationRuntime,
  type ObservationFreshnessView,
} from "../state/observationRuntime";

import type {
  ObservationListener,
  ObservationState,
  ObservationStore,
} from "../state/observationStore";


export const APPLICATION_OBSERVATION_FRESHNESS_POLICY:
  ObservationFreshnessPolicy =
    Object.freeze({
      healthMaxAgeMs:
        30_000,

      tasksMaxAgeMs:
        30_000,

      eventTailMaxAgeMs:
        30_000,
    });


export interface ApplicationObservationView {
  readonly getSnapshot:
    () => ObservationState;

  readonly subscribe:
    (
      listener:
        ObservationListener,
    ) => () => void;
}


export interface ApplicationObservationControllerView {
  readonly getSnapshot:
    () => ObservationControllerSnapshot;

  readonly subscribe:
    (
      listener:
        ObservationControllerListener,
    ) => () => void;
}


export interface ApplicationObservationSession {
  /**
   * Read-only presentation view over validated browser
   * observations.
   *
   * ObservationStore dispatch authority remains private.
   */
  readonly observations:
    ApplicationObservationView;

  /**
   * Read-only presentation view over browser-local observation
   * controller state.
   *
   * Controller lifecycle operations remain private to the
   * application session.
   */
  readonly controller:
    ApplicationObservationControllerView;

  /**
   * Browser-local freshness projection.
   *
   * Freshness is presentation metadata only. It is not trusted
   * orchestrator state and does not imply SSE liveness.
   */
  readonly freshness:
    ObservationFreshnessView;

  /**
   * Explicitly bootstrap HTTP observations and begin live
   * observation only when a validated event-tail baseline has
   * been established.
   *
   * A failed event-tail read leaves the controller idle and a
   * later explicit start() may retry bootstrap.
   */
  readonly start:
    () => Promise<BootstrapResult>;

  /**
   * Explicitly continue observation after a qualified
   * controller disconnect.
   *
   * No timer or automatic reconnect policy exists here.
   */
  readonly continue:
    () => Promise<void>;

  /**
   * Terminally stop this application observation session.
   *
   * An in-flight bootstrap is cancelled before the controller
   * is stopped.
   */
  readonly stop:
    () => void;
}


function subscribeSafely(
  subscribe:
    (
      listener:
        () => void,
    ) => () => void,

  listener:
    () => void,
): () => void {
  return subscribe(
    () => {
      try {
        listener();
      }
      catch {
        /*
         * Presentation observers are non-authoritative.
         *
         * Their failure must never escape into ObservationStore
         * dispatch or observation-controller lifecycle code.
         */
        return;
      }
    },
  );
}


function createObservationView(
  store:
    ObservationStore,
): ApplicationObservationView {
  return Object.freeze({
    getSnapshot:
      store.getSnapshot,

    subscribe(
      listener:
        ObservationListener,
    ): () => void {
      return subscribeSafely(
        store.subscribe,
        listener,
      );
    },
  });
}


function createControllerView(
  controller:
    ObservationController,
): ApplicationObservationControllerView {
  return Object.freeze({
    getSnapshot:
      controller.getSnapshot,

    subscribe(
      listener:
        ObservationControllerListener,
    ): () => void {
      return subscribeSafely(
        controller.subscribe,
        listener,
      );
    },
  });
}


export function createApplicationObservationSession():
  ApplicationObservationSession {
  /*
   * Policy and browser clock selection belong at this
   * application composition boundary.
   *
   * performance.now() is monotonic within the browser context
   * and is deliberately distinct from wall-clock/server time.
   */
  const freshnessTracker =
    createObservationFreshnessTracker(
      APPLICATION_OBSERVATION_FRESHNESS_POLICY,
      () => performance.now(),
    );


  const runtime =
    createObservationRuntime(
      undefined,
      freshnessTracker,
    );


  const freshness =
    runtime.freshness;


  /*
   * The caller supplied a tracker above. A null freshness view
   * therefore indicates a programming/composition defect and
   * must fail closed.
   */
  if (
    freshness === null
  ) {
    throw new TypeError(
      "application observation runtime did not expose freshness",
    );
  }


  const controller =
    createObservationController(
      runtime.store,
    );


  const observations =
    createObservationView(
      runtime.store,
    );


  const controllerView =
    createControllerView(
      controller,
    );


  let bootstrapInProgress =
    false;

  let bootstrapAbortController:
    AbortController | null =
      null;

  let stopped =
    false;


  const start = async ():
    Promise<BootstrapResult> => {
    if (
      stopped
    ) {
      throw new TypeError(
        "application observation session is stopped",
      );
    }


    if (
      bootstrapInProgress
    ) {
      throw new TypeError(
        "application observation bootstrap is already in progress",
      );
    }


    /*
     * Once the lower-level controller has left idle, observation
     * continuation belongs exclusively to controller.continue().
     *
     * This prevents start() from becoming a hidden reconnect
     * path.
     */
    if (
      controller
        .getSnapshot()
        .state
      !== "idle"
    ) {
      throw new TypeError(
        "application observation session has already started",
      );
    }


    const abortController =
      new AbortController();


    bootstrapInProgress =
      true;

    bootstrapAbortController =
      abortController;


    try {
      const result =
        await runtime.bootstrap(
          abortController.signal,
        );


      /*
       * stop() is terminal and may have aborted a reader that
       * ignored AbortSignal long enough to resolve anyway.
       *
       * Never construct SSE after stop/cancellation.
       */
      if (
        stopped
        || abortController
          .signal
          .aborted
      ) {
        return result;
      }


      /*
       * Live observation requires only the validated event-tail
       * baseline.
       *
       * Health/tasks may be partial independently. Their absence
       * does not justify inventing trusted execution failure.
       */
      if (
        result
          .sources
          .eventTail
        === "observed"
      ) {
        controller.start();
      }


      return result;
    }
    finally {
      if (
        bootstrapAbortController
        === abortController
      ) {
        bootstrapAbortController =
          null;
      }

      bootstrapInProgress =
        false;
    }
  };


  const continueObservation = ():
    Promise<void> => (
    controller.continue()
  );


  const stop = ():
    void => {
    if (
      stopped
    ) {
      return;
    }


    /*
     * Establish terminal application state before cancellation.
     * Any later bootstrap completion therefore remains unable to
     * create an SSE transport.
     */
    stopped =
      true;


    const abortController =
      bootstrapAbortController;

    bootstrapAbortController =
      null;


    abortController
      ?.abort();


    controller.stop();
  };


  return Object.freeze({
    observations,
    controller:
      controllerView,
    freshness,
    start,

    continue:
      continueObservation,

    stop,
  });
}


/*
 * Application-scoped observation session.
 *
 * Construction is side-effect free with respect to network and
 * timers. React bindings in N16.3a3 may consume this singleton,
 * but React remains outside all observation mutation authority.
 */
export const applicationObservationSession:
  ApplicationObservationSession =
    createApplicationObservationSession();
