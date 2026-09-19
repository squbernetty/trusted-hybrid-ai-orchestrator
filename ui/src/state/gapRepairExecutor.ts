import {
  readEventPage,
} from "../api/httpClient";

import type {
  EventPageResponse,
} from "../api/eventPage";

import {
  evaluateGapRepairPage,
  planGapRepair,
  type GapRepairEvaluation,
  type GapRepairPlan,
} from "./gapRepair";


export interface GapRepairExecutionDependencies {
  readonly readEventPage:
    (
      afterEventSeq:
        number,

      limit:
        number,

      signal?:
        AbortSignal,
    ) => Promise<
      EventPageResponse
    >;
}


export type GapRepairExecutionResult =
  | {
      readonly outcome:
        "evaluated";

      readonly plan:
        GapRepairPlan;

      readonly evaluation:
        GapRepairEvaluation;
    }
  | {
      readonly outcome:
        "failed";

      readonly plan:
        GapRepairPlan;

      readonly reason:
        "event_page_read_failed";
    }
  | {
      readonly outcome:
        "aborted";

      readonly plan:
        GapRepairPlan;
    };


const defaultDependencies:
  GapRepairExecutionDependencies =
    Object.freeze({
      readEventPage,
    });


function abortedResult(
  plan:
    GapRepairPlan,
): GapRepairExecutionResult {
  return Object.freeze({
    outcome:
      "aborted",

    plan,
  });
}


function failedResult(
  plan:
    GapRepairPlan,
): GapRepairExecutionResult {
  return Object.freeze({
    outcome:
      "failed",

    plan,

    reason:
      "event_page_read_failed",
  });
}


export async function executeGapRepairBatch(
  cursor:
    number,

  observedEventSeq:
    number,

  signal?:
    AbortSignal,

  dependencies:
    GapRepairExecutionDependencies =
      defaultDependencies,
): Promise<
  GapRepairExecutionResult
> {
  /*
   * Planning remains the authoritative input-validation
   * boundary for gap geometry.
   *
   * Invalid/non-gap inputs are programming errors and are not
   * converted into operational repair failures.
   */
  const plan =
    planGapRepair(
      cursor,
      observedEventSeq,
    );


  /*
   * Cancellation before retrieval performs no network work.
   */
  if (
    signal?.aborted
  ) {
    return abortedResult(
      plan,
    );
  }


  let page:
    EventPageResponse;

  /*
   * Only the retrieval operation is converted into an
   * operational failed/aborted result.
   *
   * Evaluation errors remain visible as contract/programming
   * failures rather than being misclassified as HTTP failure.
   */
  try {
    page =
      await dependencies
        .readEventPage(
          plan.requestAfterEventSeq,
          plan.requestLimit,
          signal,
        );
  }
  catch {
    if (
      signal?.aborted
    ) {
      return abortedResult(
        plan,
      );
    }

    return failedResult(
      plan,
    );
  }


  /*
   * Cancellation after retrieval but before evidence
   * evaluation wins. No evidence is promoted or applied.
   */
  if (
    signal?.aborted
  ) {
    return abortedResult(
      plan,
    );
  }


  const evaluation =
    evaluateGapRepairPage(
      plan,
      page,
    );


  /*
   * "evaluated" deliberately does not mean "repaired".
   *
   * The evaluation may be batch_complete or incomplete, and
   * even batch_complete may represent only one bounded batch
   * of a larger gap.
   */
  return Object.freeze({
    outcome:
      "evaluated",

    plan,

    evaluation,
  });
}
