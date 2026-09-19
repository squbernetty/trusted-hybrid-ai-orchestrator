import {
  useObservationFreshnessSnapshot,
  useObservationSnapshot,
} from "../../app/reactObservation";


export function ServiceHealth() {
  const observations =
    useObservationSnapshot();

  const freshness =
    useObservationFreshnessSnapshot();

  const healthObserved =
    observations
      .observed
      .health
    !== null;


  if (
    !healthObserved
    || freshness
      .health
      .state
      === "unobserved"
  ) {
    return (
      <div
        className="service-health"
        data-health="checking"
      >
        <span
          className="service-health__indicator"
          aria-hidden="true"
        />
        <span>
          Control plane
        </span>
        <strong>
          Not observed
        </strong>
      </div>
    );
  }


  if (
    freshness
      .health
      .state
    === "stale"
  ) {
    return (
      <div
        className="service-health"
        data-health="unavailable"
      >
        <span
          className="service-health__indicator"
          aria-hidden="true"
        />
        <span>
          Control plane
        </span>
        <strong>
          Observation stale
        </strong>
      </div>
    );
  }


  return (
    <div
      className="service-health"
      data-health="reachable"
    >
      <span
        className="service-health__indicator"
        aria-hidden="true"
      />
      <span>
        Control plane
      </span>
      <strong>
        Observed · read-only
      </strong>
    </div>
  );
}
