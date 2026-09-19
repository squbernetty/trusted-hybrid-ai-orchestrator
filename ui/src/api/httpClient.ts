import {
  parseEventTailResponse,
  parseServiceHealth,
  parseTaskStatusProjectionCollection,
  type EventTailResponse,
  type ServiceHealth,
  type TaskStatusProjectionCollection,
} from "./schemas";

import {
  parseEventPageResponse,
  type EventPageResponse,
} from "./eventPage";


type ReadOnlyEndpoint =
  | "/api/v1/health"
  | "/api/v1/tasks?limit=100"
  | "/api/v1/events/tail?limit=100"
  | `/api/v1/events?after_event_seq=${number}&limit=${number}`;


async function readJsonReadOnly(
  endpoint: ReadOnlyEndpoint,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    endpoint,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(
      "Control-plane observation request failed.",
    );
  }

  return response.json() as Promise<unknown>;
}


export async function readServiceHealth(
  signal?: AbortSignal,
): Promise<ServiceHealth> {
  const payload = await readJsonReadOnly(
    "/api/v1/health",
    signal,
  );

  return parseServiceHealth(
    payload,
  );
}


export async function readTaskStatusProjections(
  signal?: AbortSignal,
): Promise<TaskStatusProjectionCollection> {
  const payload = await readJsonReadOnly(
    "/api/v1/tasks?limit=100",
    signal,
  );

  return parseTaskStatusProjectionCollection(
    payload,
  );
}


export async function readEventTail(
  signal?: AbortSignal,
): Promise<EventTailResponse> {
  const payload = await readJsonReadOnly(
    "/api/v1/events/tail?limit=100",
    signal,
  );

  return parseEventTailResponse(
    payload,
  );
}


function assertEventPageCursor(
  afterEventSeq:
    number,
): void {
  if (
    !Number.isSafeInteger(
      afterEventSeq,
    )
    || afterEventSeq < 0
  ) {
    throw new TypeError(
      "afterEventSeq must be a safe non-negative integer",
    );
  }
}


function assertEventPageLimit(
  limit:
    number,
): void {
  if (
    !Number.isSafeInteger(
      limit,
    )
    || limit < 1
    || limit > 1000
  ) {
    throw new TypeError(
      "limit must be an integer between 1 and 1000",
    );
  }
}


export async function readEventPage(
  afterEventSeq:
    number,

  limit:
    number,

  signal?:
    AbortSignal,
): Promise<EventPageResponse> {
  assertEventPageCursor(
    afterEventSeq,
  );

  assertEventPageLimit(
    limit,
  );


  const endpoint:
    ReadOnlyEndpoint =
      `/api/v1/events?after_event_seq=${afterEventSeq}&limit=${limit}`;


  const payload =
    await readJsonReadOnly(
      endpoint,
      signal,
    );


  return parseEventPageResponse(
    payload,
    afterEventSeq,
    limit,
  );
}
