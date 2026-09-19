import {
  useState,
} from "react";

import {
  useObservationSnapshot,
} from "../app/reactObservation";

import {
  createExecutionPathPresentation,
  type ExecutionPathEvent,
} from "../presentation/executionPathProjection";


function optionalValue(
  value:
    string | null,
): string {
  return value
    ?? "—";
}


function eventContext(
  event:
    ExecutionPathEvent,
): string {
  if (
    event.executionId
    !== null
  ) {
    return `execution ${event.executionId}`;
  }

  if (
    event.requestId
    !== null
  ) {
    return `request ${event.requestId}`;
  }

  return event.component;
}


export function TaskPage() {
  const observations =
    useObservationSnapshot();

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] = useState<
    string | null
  >(
    null,
  );


  const presentation =
    createExecutionPathPresentation(
      observations,
      selectedTaskId,
    );


  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p className="page-heading__eyebrow">
            Task / Execution
          </p>

          <h1>
            Observed task trust path
          </h1>

          <p className="page-heading__summary">
            Inspect retained trusted events
            that explicitly name one selected
            task. Missing stages and
            relationships are not inferred.
          </p>
        </div>

        <span className="observation-state">
          {selectedTaskId
            === null
            ? "No task selected"
            : `Selected · ${selectedTaskId}`}
        </span>
      </header>

      <section
        className="task-path-controls"
        aria-labelledby="task-path-selection-title"
      >
        <div>
          <p className="panel-heading__label">
            Browser-local selection
          </p>

          <h2 id="task-path-selection-title">
            Select observed task
          </h2>

          <p>
            Selection changes presentation
            only. It does not change trusted
            orchestrator state.
          </p>
        </div>

        <label className="task-path-selector">
          <span>
            Task
          </span>

          <select
            value={
              selectedTaskId
              ?? ""
            }
            disabled={
              !presentation.tasksObserved
              || presentation
                .taskOptions
                .length === 0
            }
            onChange={
              (
                event,
              ) => {
                const next =
                  event
                    .currentTarget
                    .value;

                setSelectedTaskId(
                  next === ""
                    ? null
                    : next,
                );
              }
            }
          >
            <option value="">
              Choose a task…
            </option>

            {presentation
              .taskOptions
              .map(
                (
                  task,
                ) => (
                  <option
                    key={task.taskId}
                    value={task.taskId}
                  >
                    {task.taskId}
                    {" · "}
                    {task.status}
                  </option>
                ),
              )}
          </select>
        </label>

        {presentation.taskCollectionTruncated
          === true
          ? (
              <p
                className="task-path-truncation-note"
                role="note"
              >
                Observed task snapshot is
                truncated. The selector shows
                only tasks present in this
                bounded snapshot; additional
                tasks may exist.
              </p>
            )
          : null}
      </section>

      {!presentation.tasksObserved
        ? (
            <section className="empty-page-panel">
              <div className="empty-page-panel__glyph">
                TX
              </div>

              <div>
                <h2>
                  Task snapshot not observed
                </h2>

                <p>
                  The browser has no validated
                  task inventory from which an
                  explicit selection can be
                  made.
                </p>
              </div>
            </section>
          )
        : presentation
            .taskOptions
            .length === 0
          ? (
              <section className="empty-page-panel">
                <div className="empty-page-panel__glyph">
                  TX
                </div>

                <div>
                  <h2>
                    No observed tasks
                  </h2>

                  <p>
                    The validated task
                    snapshot currently
                    contains no tasks.
                  </p>
                </div>
              </section>
            )
          : selectedTaskId === null
            ? (
                <section className="empty-page-panel">
                  <div className="empty-page-panel__glyph">
                    TX
                  </div>

                  <div>
                    <h2>
                      Explicit task selection
                      required
                    </h2>

                    <p>
                      N16.4 does not
                      auto-select a task or
                      infer a current
                      execution. Choose one
                      observed task above to
                      render its retained
                      trust-path evidence.
                    </p>
                  </div>
                </section>
              )
            : (
                <>
                  <section
                    className="task-path-summary"
                    aria-label="Selected task observation"
                  >
                    <article>
                      <span>
                        Task
                      </span>

                      <strong className="mono-value">
                        {selectedTaskId}
                      </strong>
                    </article>

                    <article>
                      <span>
                        Observed status
                      </span>

                      <strong>
                        {presentation
                          .selectedTask
                          ?.status
                          ?? "Projection unavailable"}
                      </strong>
                    </article>

                    <article>
                      <span>
                        Risk
                      </span>

                      <strong>
                        {presentation
                          .selectedTask
                          ?.riskLevel
                          ?? "Not observed"}
                      </strong>
                    </article>

                    <article>
                      <span>
                        Task-linked events
                      </span>

                      <strong>
                        {presentation
                          .pathEvents
                          .length}
                      </strong>
                    </article>
                  </section>

                  <section
                    className="task-path-panel"
                    aria-labelledby="task-path-title"
                  >
                    <div className="panel-heading">
                      <div>
                        <p className="panel-heading__label">
                          Exact task_id match
                        </p>

                        <h2 id="task-path-title">
                          Observed trust path
                        </h2>
                      </div>

                      <span className="evidence-label">
                        Validated events
                      </span>
                    </div>

                    {!presentation
                      .eventBaselineObserved
                      ? (
                          <div className="observation-empty">
                            Event-tail baseline
                            not observed.
                          </div>
                        )
                      : presentation
                          .pathEvents
                          .length === 0
                        ? (
                            <div className="observation-empty">
                              No retained
                              trusted events
                              explicitly name
                              this task.
                            </div>
                          )
                        : (
                            <ol className="task-path-flow">
                              {presentation
                                .pathEvents
                                .map(
                                  (
                                    event,
                                    index,
                                  ) => (
                                    <li
                                      className="task-path-step"
                                      data-stage={event.stage}
                                      key={event.eventSeq}
                                    >
                                      <div className="task-path-step__rail">
                                        <span className="task-path-step__index">
                                          {String(
                                            index + 1,
                                          ).padStart(
                                            2,
                                            "0",
                                          )}
                                        </span>

                                        <span
                                          className="task-path-step__connector"
                                          aria-hidden="true"
                                        />
                                      </div>

                                      <article className="task-path-step__card">
                                        <div className="task-path-step__heading">
                                          <span>
                                            {event.stage}
                                          </span>

                                          <span className="mono-value">
                                            #{event.eventSeq}
                                          </span>
                                        </div>

                                        <strong className="task-path-step__event">
                                          {event.eventType}
                                        </strong>

                                        <span className="task-path-step__context">
                                          {eventContext(
                                            event,
                                          )}
                                        </span>

                                        <dl className="task-path-step__meta">
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
                                              Evidence
                                            </dt>
                                            <dd>
                                              {event.evidenceCount}
                                            </dd>
                                          </div>
                                        </dl>

                                        <time
                                          dateTime={event.occurredAt}
                                        >
                                          {event.occurredAt}
                                        </time>
                                      </article>
                                    </li>
                                  ),
                                )}
                            </ol>
                          )}

                    <div className="task-path-boundary">
                      <strong>
                        Observation boundary
                      </strong>

                      <span>
                        This path uses only
                        events currently
                        retained in the
                        browser whose
                        task_id exactly
                        equals{" "}
                        <span className="mono-value">
                          {selectedTaskId}
                        </span>
                        . Events are kept in
                        trusted event_seq
                        order. No join is
                        inferred from
                        request_id,
                        execution_id, model,
                        provider, timestamp,
                        or adjacency.
                      </span>

                      <span>
                        Retained browser
                        window:{" "}
                        {presentation
                          .retainedFirstEventSeq
                          === null
                          ? "empty"
                          : `#${presentation.retainedFirstEventSeq}–#${presentation.retainedLastEventSeq}`}
                        {" · "}
                        {presentation
                          .retainedEventCount}
                        {" "}
                        total retained
                        events. Older trusted
                        events may be absent
                        from this bounded
                        browser window.
                      </span>
                    </div>
                  </section>
                </>
              )}
    </div>
  );
}
