import {
  useState,
} from "react";

import {
  useObservationControllerSnapshot,
  useObservationSnapshot,
} from "../app/reactObservation";

import type {
  OrchestratorEventSource,
} from "../api/schemas";

import {
  createEventTimelinePresentation,
  EMPTY_EVENT_TIMELINE_FILTERS,
  type EventTimelineFilters,
  type EventTimelineItem,
} from "../presentation/eventTimelineProjection";


function optionalValue(
  value:
    string | null,
): string {
  return value
    ?? "—";
}


function exactTextFilter(
  value:
    string,
): string | null {
  return value === ""
    ? null
    : value;
}


function exactSourceFilter(
  value:
    string,
): OrchestratorEventSource | null {
  if (
    value === ""
  ) {
    return null;
  }

  switch (value) {
    case "trusted_core":
    case "execution_supervisor":
    case "provider":
    case "verification":
    case "human_authority":
      return value;

    default:
      throw new TypeError(
        "invalid source filter",
      );
  }
}


function eventIdentity(
  event:
    EventTimelineItem,
): string {
  if (
    event.taskId !== null
  ) {
    return `task ${event.taskId}`;
  }

  if (
    event.requestId !== null
  ) {
    return `request ${event.requestId}`;
  }

  if (
    event.executionId !== null
  ) {
    return `execution ${event.executionId}`;
  }

  return event.component;
}


function controllerContext(
  state:
    string,

  retainedGapEventSeq:
    number | null,
): string {
  switch (state) {
    case "streaming":
      return (
        "Browser observation transport is active. "
        + "This is not trusted execution state."
      );

    case "repairing":
      return retainedGapEventSeq === null
        ? (
            "Browser observation is repairing retained event evidence. "
            + "This is not trusted execution failure."
          )
        : (
            `Browser observation is repairing evidence before retained gap frame #${retainedGapEventSeq}. `
            + "This is not trusted execution failure."
          );

    case "disconnected":
      return retainedGapEventSeq === null
        ? (
            "Browser observation transport is disconnected. "
            + "This does not imply orchestrator execution failure."
          )
        : (
            `Browser observation transport is disconnected with unresolved retained gap frame #${retainedGapEventSeq}. `
            + "This does not imply orchestrator execution failure."
          );

    case "degraded":
      return (
        "Browser observation integrity is degraded. "
        + "This describes the observer, not trusted execution state."
      );

    case "idle":
      return (
        "Browser observation controller is idle. "
        + "No trusted execution state is inferred."
      );

    case "stopped":
      return (
        "Browser observation controller is stopped. "
        + "No trusted execution state is inferred."
      );

    default:
      return (
        "Browser observation controller state is unavailable to this presentation."
      );
  }
}


export function EventsPage() {
  const observations =
    useObservationSnapshot();

  const controller =
    useObservationControllerSnapshot();

  const [
    filters,
    setFilters,
  ] = useState<
    EventTimelineFilters
  >(
    EMPTY_EVENT_TIMELINE_FILTERS,
  );


  const timeline =
    createEventTimelinePresentation(
      observations,
      controller,
      filters,
    );


  const retainedWindow =
    timeline.retainedFirstEventSeq
    === null
      ? "empty"
      : (
          `#${timeline.retainedFirstEventSeq}`
          + "–"
          + `#${timeline.retainedLastEventSeq}`
        );


  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p className="page-heading__eyebrow">
            Event Timeline
          </p>

          <h1>
            Global retained event timeline
          </h1>

          <p className="page-heading__summary">
            Validated trusted events retained
            in the browser, shown in trusted
            event_seq order. No missing event,
            relationship, or execution state
            is manufactured.
          </p>
        </div>

        <span className="observation-state">
          Browser observer ·{" "}
          {timeline.controllerState}
        </span>
      </header>

      <section
        className="timeline-metrics"
        aria-label="Timeline observation summary"
      >
        <article>
          <span>
            Retained events
          </span>

          <strong>
            {timeline
              .eventBaselineObserved
              ? timeline.retainedEventCount
              : "Not observed"}
          </strong>

          <small>
            Bounded browser window
          </small>
        </article>

        <article>
          <span>
            Visible after filters
          </span>

          <strong>
            {timeline.filteredEventCount}
          </strong>

          <small>
            Presentation only
          </small>
        </article>

        <article>
          <span>
            Browser cursor
          </span>

          <strong className="mono-value">
            {timeline.currentEventCursor
              === null
              ? "Not established"
              : timeline.currentEventCursor}
          </strong>

          <small>
            Derived locally
          </small>
        </article>

        <article>
          <span>
            Retained window
          </span>

          <strong className="mono-value">
            {retainedWindow}
          </strong>

          <small>
            Not durable journal history
          </small>
        </article>
      </section>

      <section
        className="timeline-observer-context"
        data-controller-state={
          timeline.controllerState
        }
      >
        <div>
          <p className="panel-heading__label">
            Browser-local observation context
          </p>

          <strong>
            {timeline.controllerState}
          </strong>
        </div>

        <p>
          {controllerContext(
            timeline.controllerState,
            timeline.retainedGapEventSeq,
          )}
          {" "}
          Session generation{" "}
          {timeline.sessionGeneration}.
        </p>
      </section>

      <section
        className="timeline-filter-panel"
        aria-labelledby="timeline-filter-title"
      >
        <div className="panel-heading">
          <div>
            <p className="panel-heading__label">
              Presentation-only filters
            </p>

            <h2 id="timeline-filter-title">
              Filter retained evidence
            </h2>
          </div>

          <button
            className="timeline-filter-clear"
            type="button"
            onClick={
              () => {
                setFilters(
                  EMPTY_EVENT_TIMELINE_FILTERS,
                );
              }
            }
          >
            Clear filters
          </button>
        </div>

        <div className="timeline-filters">
          <label>
            <span>
              Event type
            </span>

            <select
              value={
                filters.eventType
                ?? ""
              }
              onChange={
                (
                  event,
                ) => {
                  setFilters({
                    ...filters,

                    eventType:
                      exactTextFilter(
                        event
                          .currentTarget
                          .value,
                      ),
                  });
                }
              }
            >
              <option value="">
                All observed types
              </option>

              {timeline
                .eventTypeOptions
                .map(
                  (
                    eventType,
                  ) => (
                    <option
                      key={eventType}
                      value={eventType}
                    >
                      {eventType}
                    </option>
                  ),
                )}
            </select>
          </label>

          <label>
            <span>
              Source class
            </span>

            <select
              value={
                filters.sourceClass
                ?? ""
              }
              onChange={
                (
                  event,
                ) => {
                  setFilters({
                    ...filters,

                    sourceClass:
                      exactSourceFilter(
                        event
                          .currentTarget
                          .value,
                      ),
                  });
                }
              }
            >
              <option value="">
                All observed sources
              </option>

              {timeline
                .sourceClassOptions
                .map(
                  (
                    source,
                  ) => (
                    <option
                      key={source}
                      value={source}
                    >
                      {source}
                    </option>
                  ),
                )}
            </select>
          </label>

          <label>
            <span>
              Exact task ID
            </span>

            <input
              value={
                filters.taskId
                ?? ""
              }
              onChange={
                (
                  event,
                ) => {
                  setFilters({
                    ...filters,

                    taskId:
                      exactTextFilter(
                        event
                          .currentTarget
                          .value,
                      ),
                  });
                }
              }
              placeholder="task-…"
              spellCheck={false}
            />
          </label>

          <label>
            <span>
              Exact execution ID
            </span>

            <input
              value={
                filters.executionId
                ?? ""
              }
              onChange={
                (
                  event,
                ) => {
                  setFilters({
                    ...filters,

                    executionId:
                      exactTextFilter(
                        event
                          .currentTarget
                          .value,
                      ),
                  });
                }
              }
              placeholder="x…"
              spellCheck={false}
            />
          </label>

          <label>
            <span>
              Exact request ID
            </span>

            <input
              value={
                filters.requestId
                ?? ""
              }
              onChange={
                (
                  event,
                ) => {
                  setFilters({
                    ...filters,

                    requestId:
                      exactTextFilter(
                        event
                          .currentTarget
                          .value,
                      ),
                  });
                }
              }
              placeholder="request-…"
              spellCheck={false}
            />
          </label>
        </div>

        <p className="timeline-filter-note">
          Filters operate only on the already
          retained browser evidence. They do
          not query the backend, mutate
          observations, or infer event
          relationships.
        </p>
      </section>

      <section
        className="timeline-panel"
        aria-labelledby="timeline-title"
      >
        <div className="panel-heading">
          <div>
            <p className="panel-heading__label">
              Trusted sequence
            </p>

            <h2 id="timeline-title">
              Retained trusted events
            </h2>
          </div>

          <span className="evidence-label">
            Ascending event_seq
          </span>
        </div>

        {!timeline.eventBaselineObserved
          ? (
              <div className="observation-empty">
                Event-tail baseline not
                observed. No timeline is
                inferred.
              </div>
            )
          : timeline.retainedEventCount === 0
            ? (
                <div className="observation-empty">
                  Validated empty event
                  baseline; no retained
                  trusted events.
                </div>
              )
            : timeline.filteredEventCount === 0
              ? (
                  <div className="observation-empty">
                    No retained trusted
                    events exactly match the
                    active presentation
                    filters.
                  </div>
                )
              : (
                  <ol className="global-event-timeline">
                    {timeline.events.map(
                      (
                        event,
                      ) => (
                        <li
                          className="global-event"
                          key={event.eventSeq}
                        >
                          <div className="global-event__rail">
                            <span className="global-event__seq mono-value">
                              #{event.eventSeq}
                            </span>

                            <span
                              className="global-event__connector"
                              aria-hidden="true"
                            />
                          </div>

                          <article className="global-event__card">
                            <div className="global-event__heading">
                              <div>
                                <strong>
                                  {event.eventType}
                                </strong>

                                <span className="mono-value">
                                  {eventIdentity(
                                    event,
                                  )}
                                </span>
                              </div>

                              <span className="global-event__source">
                                {event.sourceClass}
                              </span>
                            </div>

                            <dl className="global-event__summary">
                              <div>
                                <dt>
                                  Component
                                </dt>

                                <dd>
                                  {event.component}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Task
                                </dt>

                                <dd>
                                  {optionalValue(
                                    event.taskId,
                                  )}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Execution
                                </dt>

                                <dd>
                                  {optionalValue(
                                    event.executionId,
                                  )}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Evidence refs
                                </dt>

                                <dd>
                                  {event.evidenceCount}
                                </dd>
                              </div>
                            </dl>

                            <div className="global-event__footer">
                              <time
                                dateTime={event.occurredAt}
                              >
                                {event.occurredAt}
                              </time>

                              <details>
                                <summary>
                                  Inspect metadata
                                </summary>

                                <dl className="global-event__details">
                                  <div>
                                    <dt>
                                      Request
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.requestId,
                                      )}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>
                                      Parent execution
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.parentExecutionId,
                                      )}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>
                                      Worker role
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.workerRole,
                                      )}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>
                                      Provider
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.providerId,
                                      )}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>
                                      Model
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.modelId,
                                      )}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>
                                      State
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.stateBefore,
                                      )}
                                      {" → "}
                                      {optionalValue(
                                        event.stateAfter,
                                      )}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>
                                      Reason
                                    </dt>
                                    <dd>
                                      {optionalValue(
                                        event.reasonCode,
                                      )}
                                    </dd>
                                  </div>
                                </dl>
                              </details>
                            </div>
                          </article>
                        </li>
                      ),
                    )}
                  </ol>
                )}

        <div className="timeline-boundary-note">
          <strong>
            Observation boundary
          </strong>

          <span>
            This page is a global view over
            the browser-retained validated
            event window only. At most the
            qualified bounded window is
            retained locally; older durable
            journal events may therefore be
            absent.
          </span>

          <span>
            Ordering is the trusted retained
            event_seq order. This page does
            not sort by timestamp, reconstruct
            missing events, infer ownership,
            or join events into an execution
            path.
          </span>

          <span>
            Bootstrap event-tail freshness is
            intentionally not used as a live
            stream status indicator because it
            does not represent SSE liveness or
            event-stream completeness.
          </span>
        </div>
      </section>
    </div>
  );
}
