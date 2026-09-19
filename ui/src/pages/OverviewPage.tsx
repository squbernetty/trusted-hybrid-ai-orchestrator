import {
  useObservationControllerSnapshot,
  useObservationSnapshot,
} from "../app/reactObservation";

import {
  createOverviewPresentation,
  OVERVIEW_EVENT_DISPLAY_LIMIT,
  OVERVIEW_TASK_DISPLAY_LIMIT,
} from "../presentation/overviewProjection";


function displayOptional(
  value:
    string | null,
): string {
  return value
    ?? "—";
}


export function OverviewPage() {
  const observations =
    useObservationSnapshot();

  const controller =
    useObservationControllerSnapshot();

  const overview =
    createOverviewPresentation(
      observations,
      controller,
    );


  const taskMetric =
    overview.tasksObserved
      ? String(
          overview.taskCount,
        )
      : "Not observed";


  const eventMetric =
    overview.eventBaselineObserved
      ? String(
          overview.retainedEventCount,
        )
      : "Not observed";


  const cursorMetric =
    overview.currentEventCursor
    === null
      ? "Not established"
      : String(
          overview.currentEventCursor,
        );


  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p className="page-heading__eyebrow">
            Overview
          </p>

          <h1>
            Observation overview
          </h1>

          <p className="page-heading__summary">
            Validated task and event
            observations with browser-local
            controller context. No current
            execution is inferred.
          </p>
        </div>

        <span className="observation-state">
          Browser observer ·{" "}
          {overview.controllerState}
        </span>
      </header>

      <section
        className="overview-metrics"
        aria-label="Observation summary"
      >
        <article className="metric-card">
          <span className="metric-card__label">
            Task projections
          </span>

          <strong className="metric-card__value">
            {taskMetric}
          </strong>

          <span className="metric-card__note">
            {overview.tasksObserved
              ? overview.taskCollectionTruncated
                ? "Validated bounded snapshot · source truncated"
                : "Validated bounded snapshot"
              : "No validated task snapshot received"}
          </span>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">
            Retained events
          </span>

          <strong className="metric-card__value">
            {eventMetric}
          </strong>

          <span className="metric-card__note">
            {overview.eventBaselineObserved
              ? "Validated event evidence retained in browser"
              : "No validated event-tail baseline received"}
          </span>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">
            Browser cursor
          </span>

          <strong className="metric-card__value">
            {cursorMetric}
          </strong>

          <span className="metric-card__note">
            Derived locally · not trusted
            orchestrator state
          </span>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">
            Observation controller
          </span>

          <strong className="metric-card__value metric-card__value--state">
            {overview.controllerState}
          </strong>

          <span className="metric-card__note">
            Browser-local · generation{" "}
            {overview.sessionGeneration}
            {overview.retainedGapEventSeq
              === null
              ? ""
              : ` · retained gap #${overview.retainedGapEventSeq}`}
          </span>
        </article>
      </section>

      <div className="overview-detail-grid">
        <section
          className="observation-panel"
          aria-labelledby="overview-tasks-title"
        >
          <div className="panel-heading">
            <div>
              <p className="panel-heading__label">
                Observed inventory
              </p>

              <h2 id="overview-tasks-title">
                Task projections
              </h2>
            </div>

            <span className="evidence-label">
              Read-only
            </span>
          </div>

          {!overview.tasksObserved
            ? (
                <div className="observation-empty">
                  Task snapshot not observed.
                </div>
              )
            : overview.taskCount === 0
              ? (
                  <div className="observation-empty">
                    Validated task snapshot
                    contains no tasks.
                  </div>
                )
              : (
                  <>
                    <div className="table-scroll">
                      <table className="observation-table">
                        <thead>
                          <tr>
                            <th>
                              Task
                            </th>
                            <th>
                              Status
                            </th>
                            <th>
                              Risk
                            </th>
                            <th>
                              Next action
                            </th>
                            <th>
                              Human gate
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {overview.taskItems.map(
                            (task) => (
                              <tr key={task.taskId}>
                                <td className="mono-value">
                                  {task.taskId}
                                </td>
                                <td>
                                  {task.status}
                                </td>
                                <td>
                                  {task.riskLevel}
                                </td>
                                <td className="mono-value">
                                  {displayOptional(
                                    task.nextAction,
                                  )}
                                </td>
                                <td>
                                  <span>
                                    {displayOptional(
                                      task.humanGateStatus,
                                    )}
                                  </span>

                                  {task.humanGateApproval
                                    === null
                                    ? null
                                    : (
                                        <span className="table-secondary">
                                          {task.humanGateApproval}
                                        </span>
                                      )}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>

                    <p className="panel-footnote">
                      Showing up to{" "}
                      {OVERVIEW_TASK_DISPLAY_LIMIT}{" "}
                      tasks in observed source order.
                      No task is auto-selected.
                    </p>
                  </>
                )}
        </section>

        <section
          className="observation-panel"
          aria-labelledby="overview-events-title"
        >
          <div className="panel-heading">
            <div>
              <p className="panel-heading__label">
                Evidence window
              </p>

              <h2 id="overview-events-title">
                Recent trusted events
              </h2>
            </div>

            <span className="evidence-label">
              Validated
            </span>
          </div>

          {!overview.eventBaselineObserved
            ? (
                <div className="observation-empty">
                  Event-tail baseline not
                  observed.
                </div>
              )
            : overview.retainedEventCount === 0
              ? (
                  <div className="observation-empty">
                    Validated empty event
                    baseline; no retained
                    events.
                  </div>
                )
              : (
                  <>
                    <ol className="event-evidence-list">
                      {overview.eventItems.map(
                        (event) => (
                          <li
                            className="event-evidence"
                            key={event.eventSeq}
                          >
                            <div className="event-evidence__heading">
                              <span className="mono-value">
                                #{event.eventSeq}
                              </span>

                              <strong>
                                {event.eventType}
                              </strong>
                            </div>

                            <dl className="event-evidence__meta">
                              <div>
                                <dt>
                                  Source
                                </dt>
                                <dd>
                                  {event.sourceClass}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Task
                                </dt>
                                <dd>
                                  {displayOptional(
                                    event.taskId,
                                  )}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Execution
                                </dt>
                                <dd>
                                  {displayOptional(
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

                            <time
                              className="event-evidence__time"
                              dateTime={event.occurredAt}
                            >
                              {event.occurredAt}
                            </time>
                          </li>
                        ),
                      )}
                    </ol>

                    <p className="panel-footnote">
                      Showing the latest{" "}
                      {OVERVIEW_EVENT_DISPLAY_LIMIT}{" "}
                      retained events in trusted
                      sequence order.
                    </p>
                  </>
                )}
        </section>
      </div>

      <p className="overview-authority-note">
        Overview values are either validated
        observations or explicitly labelled
        browser-derived metadata. The UI does
        not infer a current execution,
        completion state, ETA, model binding,
        or approval that was not observed.
      </p>
    </div>
  );
}
