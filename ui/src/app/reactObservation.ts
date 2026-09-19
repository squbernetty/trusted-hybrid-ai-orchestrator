import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ObservationControllerSnapshot,
} from "../state/observationController";

import type {
  ObservationFreshnessSnapshot,
} from "../state/observationFreshness";

import type {
  ObservationState,
} from "../state/observationStore";

import {
  applicationObservationSession,
} from "./applicationObservation";


/*
 * Presentation-only cadence for rereading browser-local
 * freshness metadata.
 *
 * This does not refresh observations, mutate freshness receipt
 * state, infer transport liveness, or create trusted state.
 */
export const OBSERVATION_FRESHNESS_PRESENTATION_TICK_MS =
  1_000;


export function useObservationSnapshot():
  ObservationState {
  return useSyncExternalStore(
    applicationObservationSession
      .observations
      .subscribe,

    applicationObservationSession
      .observations
      .getSnapshot,

    applicationObservationSession
      .observations
      .getSnapshot,
  );
}


export function useObservationControllerSnapshot():
  ObservationControllerSnapshot {
  return useSyncExternalStore(
    applicationObservationSession
      .controller
      .subscribe,

    applicationObservationSession
      .controller
      .getSnapshot,

    applicationObservationSession
      .controller
      .getSnapshot,
  );
}


export function useObservationFreshnessSnapshot():
  ObservationFreshnessSnapshot {
  const [
    ,
    setPresentationTick,
  ] = useState(
    false,
  );


  useEffect(
    () => {
      /*
       * Freshness changes as browser-local receipt age increases,
       * even when no new observation is dispatched.
       *
       * The timer owns only presentation rerender cadence. The
       * qualified freshness tracker remains the sole source of
       * freshness calculation and receipt metadata.
       */
      const intervalId =
        window.setInterval(
          () => {
            setPresentationTick(
              (current) => !current,
            );
          },

          OBSERVATION_FRESHNESS_PRESENTATION_TICK_MS,
        );


      return () => {
        window.clearInterval(
          intervalId,
        );
      };
    },
    [],
  );


  return applicationObservationSession
    .freshness
    .getSnapshot();
}
