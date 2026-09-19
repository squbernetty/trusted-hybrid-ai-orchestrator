import {
  readEventTail,
  readServiceHealth,
  readTaskStatusProjections,
} from "../api/httpClient";

import {
  bootstrapObservations,
  type BootstrapReaders,
  type BootstrapResult,
} from "./bootstrapCoordinator";

import {
  createObservationStore,
  type ObservationStore,
} from "./observationStore";

import type {
  ObservationFreshnessSnapshot,
  ObservationFreshnessTracker,
} from "./observationFreshness";


export interface ObservationFreshnessView {
  /**
   * Read-only browser-local freshness projection.
   *
   * Mutation authority remains private to runtime composition.
   */
  readonly getSnapshot:
    () => ObservationFreshnessSnapshot;
}


export interface ObservationRuntime {
  readonly store:
    ObservationStore;

  /**
   * null means no caller supplied an explicit freshness policy
   * and clock for this runtime.
   */
  readonly freshness:
    ObservationFreshnessView | null;

  readonly bootstrap:
    (
      signal?: AbortSignal,
    ) => Promise<BootstrapResult>;
}


/*
 * Concrete browser observation readers.
 *
 * The HTTP adapter remains the sole owner of transport and
 * schema validation. This object only binds those qualified
 * readers to the bootstrap coordinator.
 */
const defaultBootstrapReaders:
  BootstrapReaders =
    Object.freeze({
      readHealth:
        readServiceHealth,

      readTasks:
        readTaskStatusProjections,

      readEventTail,
    });


export function createObservationRuntime(
  readers:
    BootstrapReaders =
      defaultBootstrapReaders,

  freshnessTracker?:
    ObservationFreshnessTracker,
): ObservationRuntime {
  const store =
    createObservationStore();


  const freshness:
    ObservationFreshnessView | null =
      freshnessTracker === undefined
        ? null
        : Object.freeze({
            getSnapshot:
              freshnessTracker
                .getSnapshot,
          });


  const bootstrap = (
    signal?: AbortSignal,
  ): Promise<BootstrapResult> => (
    bootstrapObservations(
      store,
      readers,
      signal,
      freshnessTracker,
    )
  );

  return Object.freeze({
    store,
    freshness,
    bootstrap,
  });
}


/*
 * Application-scoped runtime.
 *
 * Creating this object has no network side effects. Observation
 * begins only when a caller explicitly invokes bootstrap().
 *
 * No freshness tracker is constructed here because the
 * application has not yet selected an explicit freshness policy
 * or browser-local clock. The default runtime therefore exposes
 * freshness === null rather than inventing those values.
 */
export const observationRuntime:
  ObservationRuntime =
    createObservationRuntime();
